// ---------------------------------------------------------------------------
// pages/Call.tsx -- Active call page with WebRTC, signaling, and transcription
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { useAuth } from '../hooks/useAuth';
import { useAutoHideControls } from '../hooks/useAutoHideControls';
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

export default function Call() {
  const { peerId } = useParams<{ peerId: string }>();
  const [searchParams] = useSearchParams();
  const rawRole = searchParams.get('role');
  const role = rawRole === 'caller' || rawRole === 'callee' ? rawRole : null;
  const navigate = useNavigate();
  const { user } = useAuth();

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);

  const [callStatus, setCallStatus] = useState<string>(
    role === 'caller' ? 'Connecting...' : 'Answering...',
  );

  // Media + transcription via shared hook
  const {
    streamRef,
    videoRef: localVideoRef,
    remoteLang,
    transcriptEntries,
    cleanupTranscription,
    streamReady,
  } = useTranscription(peerId!);

  const { controlsHidden, showControls } = useAutoHideControls();
  const { isMuted, isCameraOff, toggleMute, toggleCamera } = useMediaToggles(streamRef);
  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord } = useSavedWords();

  // ---- Shared cleanup helper (WebRTC only — transcription handled by hook) --

  const cleanupPeer = useCallback(() => {
    if (pcRef.current) {
      closePeerConnection(pcRef.current);
      pcRef.current = null;
    }
  }, []);

  // ---- End call ----------------------------------------------------------

  const endCall = useCallback(() => {
    socket.emit('call:end', { peerId });
    cleanupTranscription();
    cleanupPeer();
    navigate('/chats');
  }, [peerId, navigate, cleanupTranscription, cleanupPeer]);

  // ---- Early listeners (NOT gated on streamReady) -------------------------
  // These register immediately so events that arrive while getUserMedia is
  // still running are not lost. signal:offer is buffered until the PC exists.

  useEffect(() => {
    if (!peerId) return;

    const onCallEnded = () => {
      setCallStatus('Call ended');
      cleanupTranscription();
      cleanupPeer();
      setTimeout(() => navigate('/chats'), 1500);
    };

    const onCallRejected = () => {
      setCallStatus('Call rejected');
      cleanupPeer();
      setTimeout(() => navigate('/chats'), 1500);
    };

    const onCallError = (data: { message: string }) => {
      console.error('[call] call:error:', data.message);
      setCallStatus(data.message);
      cleanupPeer();
      setTimeout(() => navigate('/chats'), 2500);
    };

    // Buffer the offer if it arrives before our PC is ready (callee flow).
    // The gated effect will process pendingOfferRef once the PC is created.
    const onSignalOfferEarly = (data: { offer: RTCSessionDescriptionInit; fromUserId: string }) => {
      if (role !== 'callee') return;
      if (pcRef.current && streamRef.current) return; // will be handled by gated listener
      pendingOfferRef.current = data.offer;
    };

    socket.on('call:ended', onCallEnded);
    socket.on('call:rejected', onCallRejected);
    socket.on('call:error', onCallError);
    socket.on('signal:offer', onSignalOfferEarly);

    return () => {
      socket.off('call:ended', onCallEnded);
      socket.off('call:rejected', onCallRejected);
      socket.off('call:error', onCallError);
      socket.off('signal:offer', onSignalOfferEarly);
    };
  }, [peerId, role, navigate, cleanupTranscription, cleanupPeer]);

  // ---- Timeout for stuck states ------------------------------------------

  useEffect(() => {
    if (!callStatus) return;
    if (callStatus === 'Call ended' || callStatus === 'Call rejected') return;

    const timeout = setTimeout(() => {
      if (callStatus === 'Ringing...' || callStatus === 'Waiting for connection...' || callStatus === 'Answering...' || callStatus === 'Connecting...') {
        setCallStatus('Connection timed out');
        cleanupTranscription();
        cleanupPeer();
        setTimeout(() => navigate('/chats'), 2000);
      }
    }, 30_000);

    return () => clearTimeout(timeout);
  }, [callStatus, navigate, cleanupTranscription, cleanupPeer]);

  // ---- WebRTC peer connection + signaling (gated on streamReady) ----------

  useEffect(() => {
    if (!streamReady || !peerId || !role) return;

    let cleaned = false;

    // --- Socket event handlers ---

    const onCallAccepted = async () => {
      if (role !== 'caller') return;
      if (!pcRef.current || !streamRef.current) {
        console.warn('[call] call:accepted arrived but PC not ready yet');
        return;
      }
      setCallStatus('Connecting...');
      try {
        const offer = await createOffer(pcRef.current, streamRef.current);
        socket.emit('signal:offer', { peerId, offer });
      } catch (err) {
        console.error('[call] Error creating offer:', err);
      }
    };

    const onSignalOffer = async (data: { offer: RTCSessionDescriptionInit; fromUserId: string }) => {
      if (role !== 'callee') return;
      if (!pcRef.current || !streamRef.current) {
        console.warn('[call] signal:offer arrived but PC not ready yet');
        return;
      }
      try {
        const answer = await createAnswer(pcRef.current, data.offer, streamRef.current);
        socket.emit('signal:answer', { peerId, answer });
        setCallStatus('');
      } catch (err) {
        console.error('[call] Error creating answer:', err);
      }
    };

    const onSignalAnswer = async (data: { answer: RTCSessionDescriptionInit }) => {
      if (role !== 'caller') return;
      if (!pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription(
          new RTCSessionDescription(data.answer),
        );
        setCallStatus('');
      } catch (err) {
        console.error('[call] Error setting remote description:', err);
      }
    };

    const onIceCandidate = (data: { candidate: RTCIceCandidateInit }) => {
      if (!pcRef.current) return;
      addIceCandidate(pcRef.current, data.candidate);
    };

    socket.on('call:accepted', onCallAccepted);
    socket.on('signal:offer', onSignalOffer);
    socket.on('signal:answer', onSignalAnswer);
    socket.on('signal:ice-candidate', onIceCandidate);

    // --- Create peer connection ---

    const pc = createPeerConnection(
      // onTrack -- remote media
      (event) => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
        setCallStatus('');
      },
      // onIceCandidate
      (candidate) => {
        if (candidate) {
          socket.emit('signal:ice-candidate', {
            peerId,
            candidate: candidate.toJSON(),
          });
        }
      },
      // onIceFailure
      () => {
        setCallStatus('Connection failed — try again');
        cleanupTranscription();
        cleanupPeer();
        setTimeout(() => navigate('/chats'), 2500);
      },
    );

    if (cleaned) {
      closePeerConnection(pc);
      return;
    }
    pcRef.current = pc;

    // --- Role-based signaling ---
    if (role === 'caller') {
      socket.emit('call:initiate', { peerId });
      setCallStatus('Ringing...');
    } else {
      // Callee: call:accept was already emitted by IncomingCall on click.
      // If the offer arrived before our PC was ready, process it now.
      setCallStatus('Waiting for connection...');
      if (pendingOfferRef.current) {
        const buffered = pendingOfferRef.current;
        pendingOfferRef.current = null;
        (async () => {
          try {
            const answer = await createAnswer(pc, buffered, streamRef.current!);
            socket.emit('signal:answer', { peerId, answer });
            setCallStatus('');
          } catch (err) {
            console.error('[call] Error processing buffered offer:', err);
          }
        })();
      }
    }

    return () => {
      cleaned = true;

      socket.off('call:accepted', onCallAccepted);
      socket.off('signal:offer', onSignalOffer);
      socket.off('signal:answer', onSignalAnswer);
      socket.off('signal:ice-candidate', onIceCandidate);

      cleanupPeer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamReady, peerId, role]);

  // ---- Render ------------------------------------------------------------

  if (!role) {
    return (
      <div className="call-page">
        <div className="call-status-overlay">
          <p className="call-status-text">Invalid call role: "{rawRole}". Must be "caller" or "callee".</p>
          <button className="btn btn-primary" onClick={() => navigate('/chats')}>Go Home</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`call-page${controlsHidden ? ' controls-hidden' : ''}`}
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
      <div className="call-video-area">
        {/* Remote (large) video */}
        <video
          ref={remoteVideoRef}
          className="call-remote-video"
          autoPlay
          playsInline
        />

        {/* Local (small) video overlay */}
        <video
          ref={localVideoRef}
          className="call-local-video"
          autoPlay
          playsInline
          muted
        />

        {/* Status overlay */}
        {callStatus && (
          <div className="call-status-overlay">
            <p className="call-status-text">{callStatus}</p>
          </div>
        )}

        {/* Controls */}
        <CallControls
          isMuted={isMuted}
          isCameraOff={isCameraOff}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          primaryAction={{
            label: 'End Call',
            icon: <PhoneOffIcon />,
            onClick: endCall,
            variant: 'danger',
          }}
        />
      </div>

      <TranscriptPanel entries={transcriptEntries} nativeLang={user?.native_language ?? undefined} targetLang={(remoteLang || user?.target_language) ?? undefined} savedWords={savedWordsSet} isWordSaved={isWordSaved} isDefinitionSaved={isDefinitionSaved} onSaveWord={addWord} />
    </div>
  );
}
