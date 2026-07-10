// ---------------------------------------------------------------------------
// contexts/CallProvider.tsx -- App-level 1:1 call session state.
//
// Owns the WebRTC peer connection, local media, transcription, signaling
// socket handlers, sounds, and timeouts for a 1:1 call so the call survives
// in-app route navigation. pages/Call.tsx and FloatingCallTile are thin
// views over useActiveCall().
// ---------------------------------------------------------------------------

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { socket } from '../socket';
import { useLocalMedia } from '../hooks/useLocalMedia';
import type { LocalMediaError, LocalMediaStatus } from '../hooks/useLocalMedia';
import { useMediaToggles } from '../hooks/useMediaToggles';
import { useTranscription } from '../hooks/useTranscription';
import { useScreenShare } from '../hooks/useScreenShare';
import {
  createPeerConnection,
  createOffer,
  createAnswer,
  addIceCandidate,
  closePeerConnection,
} from '../webrtc';
import { getIceServers } from '../api';
import {
  startRinging,
  stopRinging,
  playCallConnectedSound,
  playCallEndedSound,
  playCallDeclinedSound,
} from '../utils/sounds';
import type { TranscriptEntry } from '../components/TranscriptPanel';

export type CallRole = 'caller' | 'callee';

export interface StartCallParams {
  peerId: string;
  role: CallRole;
  callId: string | null;
  displayName: string;
}

interface CallParams {
  peerId: string;
  role: CallRole;
  displayName: string;
}

interface SignalOffer {
  callId?: string;
  offer: RTCSessionDescriptionInit;
  fromUserId: string;
}

interface SignalIce {
  callId?: string;
  candidate: RTCIceCandidateInit | null;
}

/** Map a server ended_reason to a user-facing status message. */
function endReasonMessage(reason: string | undefined, peerName: string): string {
  switch (reason) {
    case 'left': return `${peerName} left the call`;
    case 'disconnected': return `${peerName} disconnected`;
    case 'timeout': return 'Connection timed out';
    case 'cancelled': return 'Call cancelled';
    case 'completed': return 'Call ended';
    default: return 'Call ended';
  }
}

export interface ActiveCallValue {
  /** True while a call session exists (including the brief "ended" state). */
  active: boolean;
  /** True once the call has finished (status message showing, about to clear). */
  callEnded: boolean;
  peerId: string | null;
  role: CallRole | null;
  displayName: string;
  callId: string | null;
  callStatus: string;
  turnWarning: string;
  remoteStream: MediaStream | null;
  remoteHasVideo: boolean;
  mediaStatus: LocalMediaStatus;
  mediaError: LocalMediaError | null;
  localVideoRef: React.RefObject<HTMLVideoElement>;
  localStreamRef: React.MutableRefObject<MediaStream | null>;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  transcriptEntries: TranscriptEntry[];
  remoteLang: string;
  startCall: (params: StartCallParams) => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => void;
  retryMedia: () => Promise<MediaStream | undefined>;
}

const CallContext = createContext<ActiveCallValue | null>(null);

export function useActiveCall(): ActiveCallValue {
  const value = useContext(CallContext);
  if (!value) {
    throw new Error('useActiveCall must be used within CallProvider');
  }
  return value;
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const activeCallIdRef = useRef<string | null>(null);
  const pendingOfferRef = useRef<SignalOffer | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingCallerOfferRef = useRef(false);
  const initiatedRef = useRef(false);
  const connectedSoundPlayedRef = useRef(false);
  const callOverRef = useRef(false);
  const paramsRef = useRef<CallParams | null>(null);

  const [params, setParams] = useState<CallParams | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState('');
  const [callEnded, setCallEnded] = useState(false);
  const [turnWarning, setTurnWarning] = useState('');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);

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
    setMicMuted,
  } = useTranscription(params?.peerId ?? '', streamRef, streamReady);

  const { isMuted, isCameraOff, toggleMute, toggleCamera, reset: resetToggles } = useMediaToggles(streamRef);
  const { isScreenSharing, toggleScreenShare } = useScreenShare(streamRef, pcRef, localVideoRef);

  const handleToggleMute = useCallback(() => {
    toggleMute();
    const audioTrack = streamRef.current?.getAudioTracks()[0];
    setMicMuted(audioTrack ? !audioTrack.enabled : false);
  }, [toggleMute, setMicMuted, streamRef]);

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
    setRemoteStream(null);
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

  /** Fully clear the call session (after the ended status has been shown). */
  const clearCall = useCallback(() => {
    paramsRef.current = null;
    setParams(null);
    activeCallIdRef.current = null;
    setActiveCallId(null);
    setCallStatus('');
    setCallEnded(false);
    setTurnWarning('');
    initiatedRef.current = false;
    connectedSoundPlayedRef.current = false;
    callOverRef.current = false;
    resetToggles();
  }, [resetToggles]);

  const finishCallLocally = useCallback((status: string, sound: 'ended' | 'declined' | 'none' = 'ended') => {
    callOverRef.current = true;
    stopRinging();
    if (sound === 'declined') {
      playCallDeclinedSound();
    } else if (sound === 'ended') {
      playCallEndedSound();
    }
    setCallStatus(status);
    setCallEnded(true);
    cleanupTranscription();
    cleanupPeer();
    stopMedia();
    // Keep the ended status visible long enough for the call page to show it
    // and navigate away (1.5s), then drop the session entirely.
    setTimeout(() => clearCall(), 1800);
  }, [cleanupPeer, cleanupTranscription, clearCall, stopMedia]);

  const endCall = useCallback(() => {
    const callId = activeCallIdRef.current;
    const peerId = paramsRef.current?.peerId;
    if (callId) {
      socket.emit('call:end', { callId });
    } else if (peerId) {
      socket.emit('call:end', { peerId });
    }
    finishCallLocally('Call ended');
  }, [finishCallLocally]);

  const startCall = useCallback((start: StartCallParams) => {
    if (paramsRef.current) return; // a call session already exists
    callOverRef.current = false;
    setCallEnded(false);
    activeCallIdRef.current = start.callId;
    setActiveCallId(start.callId);
    setCallStatus(start.role === 'caller' ? 'Preparing call...' : 'Preparing answer...');
    const next: CallParams = {
      peerId: start.peerId,
      role: start.role,
      displayName: start.displayName,
    };
    paramsRef.current = next;
    setParams(next);
  }, []);

  const sendCallerOffer = useCallback(async () => {
    const pc = pcRef.current;
    const stream = streamRef.current;
    const callId = activeCallIdRef.current;
    const peerId = paramsRef.current?.peerId;
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
  }, [streamRef]);

  const answerOffer = useCallback(async (data: SignalOffer) => {
    const pc = pcRef.current;
    const stream = streamRef.current;
    const peerId = paramsRef.current?.peerId;
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
  }, [flushPendingIce, setCallId, streamRef]);

  // Acquire local media when a call session starts.
  useEffect(() => {
    if (!params) return;
    startMedia().catch(() => {
      // mediaError state (set inside useLocalMedia) drives the blocking
      // overlay; clear the transient "Preparing..." status underneath it.
      setCallStatus('');
    });
  }, [params, startMedia]);

  // Signaling socket handlers, bound while a call session exists.
  useEffect(() => {
    if (!params) return;
    const { peerId, role, displayName } = params;

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

    const onCallEnded = (data: { callId?: string; reason?: string }) => {
      if (!matchesCall(data.callId)) return;
      finishCallLocally(endReasonMessage(data.reason, displayName));
    };

    const onCallRejected = (data: { callId?: string }) => {
      if (!matchesCall(data.callId)) return;
      finishCallLocally('Call declined', 'declined');
    };

    const onCallCancelled = (data: { callId?: string; reason?: string }) => {
      if (!matchesCall(data.callId)) return;
      finishCallLocally(endReasonMessage(data.reason, displayName));
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
  }, [answerOffer, finishCallLocally, flushPendingIce, params, sendCallerOffer, setCallId]);

  // Notify the server when the tab actually closes during a live call.
  // (In-app navigation no longer ends the call -- the session lives here.)
  useEffect(() => {
    const callInProgress = () => !callOverRef.current && !!activeCallIdRef.current;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!callInProgress()) return;
      e.preventDefault();
      e.returnValue = '';
    };

    const onPageHide = () => {
      if (!callInProgress()) return;
      socket.emit('call:end', { callId: activeCallIdRef.current, reason: 'left' });
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Create the peer connection once local media is ready.
  useEffect(() => {
    if (!params || !streamReady || pcRef.current) return;
    const { peerId, role } = params;
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
          if (event.streams[0]) {
            setRemoteStream(event.streams[0]);
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
          finishCallLocally('Connection failed. Try again.', 'none');
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
  }, [answerOffer, finishCallLocally, params, sendCallerOffer, streamReady]);

  // 30s connect timeout while the call is still in a pre-connected state.
  useEffect(() => {
    if (!params) return;
    if (!callStatus || callStatus === 'Call ended' || callStatus === 'Call declined') return;
    const timeout = setTimeout(() => {
      if (['Ringing...', 'Waiting for connection...', 'Preparing call...', 'Preparing answer...', 'Connecting...', 'Calling...'].includes(callStatus)) {
        const callId = activeCallIdRef.current;
        const peerId = paramsRef.current?.peerId;
        if (callId) {
          socket.emit('call:end', { callId, reason: 'timeout' });
        } else if (peerId) {
          socket.emit('call:end', { peerId, reason: 'timeout' });
        }
        finishCallLocally('Connection timed out');
      }
    }, 30_000);

    return () => clearTimeout(timeout);
  }, [callStatus, finishCallLocally, params]);

  // Provider unmount (app teardown): stop everything.
  useEffect(() => {
    return () => {
      stopRinging();
      cleanupTranscription();
      cleanupPeer();
      stopMedia();
    };
  }, [cleanupPeer, cleanupTranscription, stopMedia]);

  const value: ActiveCallValue = {
    active: params !== null,
    callEnded,
    peerId: params?.peerId ?? null,
    role: params?.role ?? null,
    displayName: params?.displayName ?? '',
    callId: activeCallId,
    callStatus,
    turnWarning,
    remoteStream,
    remoteHasVideo,
    mediaStatus,
    mediaError,
    localVideoRef,
    localStreamRef: streamRef,
    isMuted,
    isCameraOff,
    isScreenSharing,
    transcriptEntries,
    remoteLang,
    startCall,
    endCall,
    toggleMute: handleToggleMute,
    toggleCamera,
    toggleScreenShare,
    retryMedia: startMedia,
  };

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
