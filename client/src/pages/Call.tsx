// ---------------------------------------------------------------------------
// pages/Call.tsx -- Active 1:1 call page with callId-scoped WebRTC
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { useAuth } from '../hooks/useAuth';
import { useAutoHideControls } from '../hooks/useAutoHideControls';
import { useLocalMedia } from '../hooks/useLocalMedia';
import { useMediaToggles } from '../hooks/useMediaToggles';
import { useTranscription } from '../hooks/useTranscription';
import {
  createPeerConnection,
  createOffer,
  createAnswer,
  addIceCandidate,
  closePeerConnection,
} from '../webrtc';
import CallControls, { PhoneOffIcon } from '../components/CallControls';
import TranscriptPanel from '../components/TranscriptPanel';
import { useSavedWords } from '../hooks/useSavedWords';
import { useScreenShare } from '../hooks/useScreenShare';
import { getIceServers } from '../api';
import {
  startRinging,
  stopRinging,
  playCallConnectedSound,
  playCallEndedSound,
  playCallDeclinedSound,
} from '../utils/sounds';

type CallRole = 'caller' | 'callee';

interface SignalOffer {
  callId?: string;
  offer: RTCSessionDescriptionInit;
  fromUserId: string;
}

interface SignalIce {
  callId?: string;
  candidate: RTCIceCandidateInit | null;
}

export default function Call() {
  const { peerId } = useParams<{ peerId: string }>();
  const [searchParams] = useSearchParams();
  const rawRole = searchParams.get('role');
  const role: CallRole | null = rawRole === 'caller' || rawRole === 'callee' ? rawRole : null;
  const initialCallId = searchParams.get('callId');
  const displayName = searchParams.get('name') || 'Polycast call';
  const navigate = useNavigate();
  const { user } = useAuth();

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const activeCallIdRef = useRef<string | null>(initialCallId);
  const pendingOfferRef = useRef<SignalOffer | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingCallerOfferRef = useRef(false);
  const initiatedRef = useRef(false);
  const connectedSoundPlayedRef = useRef(false);

  const [activeCallId, setActiveCallId] = useState<string | null>(initialCallId);
  const [callStatus, setCallStatus] = useState<string>(
    role === 'caller' ? 'Preparing call...' : 'Preparing answer...',
  );
  const [turnWarning, setTurnWarning] = useState('');
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(true);

  const {
    streamRef,
    videoRef: localVideoRef,
    status: mediaStatus,
    error: mediaError,
    streamReady,
    start: startMedia,
    stop: stopMedia,
  } = useLocalMedia({ video: true, audio: true });

  const {
    remoteLang,
    transcriptEntries,
    cleanupTranscription,
  } = useTranscription(peerId || '', streamRef, streamReady);

  const { controlsHidden, showControls } = useAutoHideControls();
  const { isMuted, isCameraOff, toggleMute, toggleCamera } = useMediaToggles(streamRef);
  const { isScreenSharing, toggleScreenShare } = useScreenShare(streamRef, pcRef, localVideoRef);
  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord, addOptimistic, removeWord } = useSavedWords();

  const setCallId = useCallback((callId: string | null) => {
    activeCallIdRef.current = callId;
    setActiveCallId(callId);
  }, []);

  const cleanupPeer = useCallback(() => {
    if (pcRef.current) {
      closePeerConnection(pcRef.current);
      pcRef.current = null;
    }
    pendingOfferRef.current = null;
    pendingIceRef.current = [];
    pendingCallerOfferRef.current = false;
    setRemoteHasVideo(false);
  }, []);

  const flushPendingIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) return;
    const candidates = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const candidate of candidates) {
      await addIceCandidate(pc, candidate);
    }
  }, []);

  const finishCallLocally = useCallback((status: string, sound: 'ended' | 'declined' = 'ended') => {
    stopRinging();
    if (sound === 'declined') {
      playCallDeclinedSound();
    } else {
      playCallEndedSound();
    }
    setCallStatus(status);
    cleanupTranscription();
    cleanupPeer();
    stopMedia();
    setTimeout(() => navigate('/chats'), 1500);
  }, [cleanupPeer, cleanupTranscription, navigate, stopMedia]);

  const endCall = useCallback(() => {
    const callId = activeCallIdRef.current;
    if (callId) {
      socket.emit('call:end', { callId });
    } else if (peerId) {
      socket.emit('call:end', { peerId });
    }
    finishCallLocally('Call ended');
  }, [finishCallLocally, peerId]);

  const sendCallerOffer = useCallback(async () => {
    const pc = pcRef.current;
    const stream = streamRef.current;
    const callId = activeCallIdRef.current;
    if (!pc || !stream || !peerId || !callId) {
      pendingCallerOfferRef.current = true;
      return;
    }

    pendingCallerOfferRef.current = false;
    setCallStatus('Connecting...');
    try {
      const offer = await createOffer(pc, stream);
      socket.emit('signal:offer', { callId, peerId, offer });
    } catch (err) {
      console.error('[call] Error creating offer:', err);
      setCallStatus('Failed to create call offer');
    }
  }, [peerId, streamRef]);

  const answerOffer = useCallback(async (data: SignalOffer) => {
    const pc = pcRef.current;
    const stream = streamRef.current;
    if (!pc || !stream || !peerId) {
      pendingOfferRef.current = data;
      return;
    }

    const callId = data.callId || activeCallIdRef.current;
    if (callId) setCallId(callId);

    try {
      const answer = await createAnswer(pc, data.offer, stream);
      await flushPendingIce();
      socket.emit('signal:answer', { callId, peerId, answer });
      setCallStatus('');
    } catch (err) {
      console.error('[call] Error creating answer:', err);
      setCallStatus('Failed to answer call');
    }
  }, [flushPendingIce, peerId, setCallId, streamRef]);

  useEffect(() => {
    setCallId(activeCallId);
  }, [activeCallId, setCallId]);

  useEffect(() => {
    startMedia().catch(() => {
      setCallStatus('');
    });
  }, [startMedia]);

  useEffect(() => {
    if (!peerId || !role) return;

    const matchesCall = (callId?: string) => !callId || !activeCallIdRef.current || callId === activeCallIdRef.current;

    const onCallRinging = (data: { callId: string; peerId: string }) => {
      if (role !== 'caller' || data.peerId !== peerId) return;
      setCallId(data.callId);
      setCallStatus('Ringing...');
      startRinging();
    };

    const onCallAccepted = (data: { callId?: string }) => {
      if (role !== 'caller' || !matchesCall(data.callId)) return;
      if (data.callId) setCallId(data.callId);
      stopRinging();
      void sendCallerOffer();
    };

    const onSignalOffer = (data: SignalOffer) => {
      if (role !== 'callee' || !matchesCall(data.callId)) return;
      void answerOffer(data);
    };

    const onSignalAnswer = async (data: { callId?: string; answer: RTCSessionDescriptionInit }) => {
      if (role !== 'caller' || !matchesCall(data.callId) || !pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        await flushPendingIce();
        setCallStatus('');
      } catch (err) {
        console.error('[call] Error setting remote answer:', err);
        setCallStatus('Failed to connect call');
      }
    };

    const onIceCandidate = (data: SignalIce) => {
      if (!matchesCall(data.callId)) return;
      const pc = pcRef.current;
      if (!pc || !data.candidate) return;
      if (!pc.remoteDescription) {
        pendingIceRef.current.push(data.candidate);
        return;
      }
      void addIceCandidate(pc, data.candidate);
    };

    const onCallEnded = (data: { callId?: string }) => {
      if (!matchesCall(data.callId)) return;
      finishCallLocally('Call ended');
    };

    const onCallRejected = (data: { callId?: string }) => {
      if (!matchesCall(data.callId)) return;
      finishCallLocally('Call declined', 'declined');
    };

    const onCallCancelled = (data: { callId?: string; reason?: string }) => {
      if (!matchesCall(data.callId)) return;
      finishCallLocally(data.reason || 'Call cancelled');
    };

    const onCallBusy = (data: { message?: string }) => {
      finishCallLocally(data.message || 'User is already in a call', 'declined');
    };

    const onCallError = (data: { callId?: string; message: string }) => {
      if (!matchesCall(data.callId)) return;
      console.error('[call] call:error:', data.message);
      finishCallLocally(data.message);
    };

    socket.on('call:ringing', onCallRinging);
    socket.on('call:accepted', onCallAccepted);
    socket.on('call:rejected', onCallRejected);
    socket.on('call:ended', onCallEnded);
    socket.on('call:cancelled', onCallCancelled);
    socket.on('call:busy', onCallBusy);
    socket.on('call:error', onCallError);
    socket.on('signal:offer', onSignalOffer);
    socket.on('signal:answer', onSignalAnswer);
    socket.on('signal:ice-candidate', onIceCandidate);

    return () => {
      socket.off('call:ringing', onCallRinging);
      socket.off('call:accepted', onCallAccepted);
      socket.off('call:rejected', onCallRejected);
      socket.off('call:ended', onCallEnded);
      socket.off('call:cancelled', onCallCancelled);
      socket.off('call:busy', onCallBusy);
      socket.off('call:error', onCallError);
      socket.off('signal:offer', onSignalOffer);
      socket.off('signal:answer', onSignalAnswer);
      socket.off('signal:ice-candidate', onIceCandidate);
    };
  }, [answerOffer, finishCallLocally, flushPendingIce, peerId, role, sendCallerOffer, setCallId]);

  useEffect(() => {
    if (!streamReady || !peerId || !role || pcRef.current) return;
    let cleaned = false;

    (async () => {
      let iceServers: RTCIceServer[];
      try {
        const config = await getIceServers();
        iceServers = config.iceServers;
        if (!config.turnAvailable) {
          setTurnWarning('TURN relay is not configured. This call may fail on restrictive networks.');
        }
      } catch (err) {
        console.error('[call] Failed to fetch ICE servers:', err);
        setCallStatus(err instanceof Error ? err.message : 'Failed to load ICE servers');
        return;
      }

      if (cleaned) return;

      const pc = createPeerConnection(
        (event) => {
          if (remoteVideoRef.current && event.streams[0]) {
            remoteVideoRef.current.srcObject = event.streams[0];
            setRemoteHasVideo(event.streams[0].getVideoTracks().length > 0);
          }
          stopRinging();
          if (!connectedSoundPlayedRef.current) {
            connectedSoundPlayedRef.current = true;
            playCallConnectedSound();
          }
          setCallStatus('');
        },
        (candidate) => {
          const callId = activeCallIdRef.current;
          if (candidate && peerId) {
            socket.emit('signal:ice-candidate', {
              callId,
              peerId,
              candidate: candidate.toJSON(),
            });
          }
        },
        () => {
          setCallStatus('Connection failed. Try again.');
          cleanupTranscription();
          cleanupPeer();
          setTimeout(() => navigate('/chats'), 2500);
        },
        iceServers,
      );

      if (cleaned) {
        closePeerConnection(pc);
        return;
      }
      pcRef.current = pc;

      if (role === 'caller') {
        if (!initiatedRef.current) {
          initiatedRef.current = true;
          socket.emit('call:initiate', { peerId, mode: 'video' });
          setCallStatus('Calling...');
        }
      } else {
        setCallStatus('Waiting for connection...');
        if (pendingOfferRef.current) {
          const offer = pendingOfferRef.current;
          pendingOfferRef.current = null;
          void answerOffer(offer);
        }
      }

      if (pendingCallerOfferRef.current) {
        void sendCallerOffer();
      }
    })();

    return () => {
      cleaned = true;
    };
  }, [answerOffer, cleanupPeer, cleanupTranscription, navigate, peerId, role, sendCallerOffer, streamReady]);

  useEffect(() => {
    if (!callStatus || callStatus === 'Call ended' || callStatus === 'Call declined') return;
    const timeout = setTimeout(() => {
      if (['Ringing...', 'Waiting for connection...', 'Preparing call...', 'Preparing answer...', 'Connecting...', 'Calling...'].includes(callStatus)) {
        const callId = activeCallIdRef.current;
        if (callId) {
          socket.emit('call:end', { callId, reason: 'timeout' });
        } else if (peerId) {
          socket.emit('call:end', { peerId, reason: 'timeout' });
        }
        finishCallLocally('Connection timed out');
      }
    }, 30_000);

    return () => clearTimeout(timeout);
  }, [callStatus, finishCallLocally, peerId]);

  useEffect(() => {
    return () => {
      stopRinging();
      cleanupTranscription();
      cleanupPeer();
      stopMedia();
    };
  }, [cleanupPeer, cleanupTranscription, stopMedia]);

  if (!role) {
    return (
      <div className="call-page">
        <div className="call-status-overlay">
          <p className="call-status-text">Invalid call role: "{rawRole}".</p>
          <button className="btn btn-primary" onClick={() => navigate('/chats')}>Go Home</button>
        </div>
      </div>
    );
  }

  const blockingMessage = mediaError ? `${mediaError.title}. ${mediaError.message}` : callStatus;
  const showStatus = !!blockingMessage;

  return (
    <div
      className={`call-page call-page--new${controlsHidden ? ' controls-hidden' : ''}${transcriptOpen ? ' transcript-open' : ''}`}
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
      <div className="call-video-area">
        <video
          ref={remoteVideoRef}
          className="call-remote-video"
          autoPlay
          playsInline
        />

        {!remoteHasVideo && !callStatus && (
          <div className="call-remote-placeholder">
            <div className="call-avatar">{displayName.slice(0, 1).toUpperCase()}</div>
            <div>
              <div className="call-peer-name">{displayName}</div>
              <div className="call-peer-subtitle">Camera is off</div>
            </div>
          </div>
        )}

        <div className="call-top-bar">
          <div>
            <div className="call-top-name">{displayName}</div>
            <div className="call-top-status">
              {activeCallId ? `Call ${activeCallId.slice(0, 8)}` : mediaStatus === 'requesting' ? 'Requesting camera and microphone' : 'Ready'}
            </div>
          </div>
          {turnWarning && <div className="call-network-warning">{turnWarning}</div>}
        </div>

        <div className={`call-local-tile${isCameraOff ? ' camera-off' : ''}`}>
          <video
            ref={localVideoRef}
            className="call-local-video"
            autoPlay
            playsInline
            muted
          />
          {isCameraOff && <div className="call-local-off">Camera off</div>}
        </div>

        {showStatus && (
          <div className="call-status-overlay">
            <div className="call-status-card">
              <p className="call-status-text">{blockingMessage}</p>
              {mediaError && (
                <button className="btn btn-primary" onClick={() => startMedia().catch(() => undefined)}>
                  Try Again
                </button>
              )}
            </div>
          </div>
        )}

        <button
          className="call-transcript-toggle"
          type="button"
          onClick={() => setTranscriptOpen((open) => !open)}
        >
          {transcriptOpen ? 'Hide transcript' : 'Show transcript'}
        </button>

        <CallControls
          isMuted={isMuted}
          isCameraOff={isCameraOff}
          isScreenSharing={isScreenSharing}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          onToggleScreenShare={toggleScreenShare}
          primaryAction={{
            label: 'End Call',
            icon: <PhoneOffIcon />,
            onClick: endCall,
            variant: 'danger',
          }}
        />
      </div>

      {transcriptOpen && (
        <TranscriptPanel
          entries={transcriptEntries}
          nativeLang={user?.native_language ?? undefined}
          targetLang={(remoteLang || user?.target_language) ?? undefined}
          savedWords={savedWordsSet}
          isWordSaved={isWordSaved}
          isDefinitionSaved={isDefinitionSaved}
          onSaveWord={addWord}
          onRemoveWord={removeWord}
          onOptimisticSave={addOptimistic}
        />
      )}
    </div>
  );
}
