// ---------------------------------------------------------------------------
// pages/Call.tsx -- Active call page with WebRTC, signaling, and transcription
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { useAuth } from '../hooks/useAuth';
import { useAutoHideControls } from '../hooks/useAutoHideControls';
import { useMediaToggles } from '../hooks/useMediaToggles';
import {
  createPeerConnection,
  createOffer,
  createAnswer,
  addIceCandidate,
  closePeerConnection,
} from '../webrtc';
import { TranscriptionService } from '../transcription';
import SubtitleBar from '../components/SubtitleBar';
import CallControls, { PhoneOffIcon } from '../components/CallControls';
import { useSavedWords } from '../hooks/useSavedWords';

export default function Call() {
  const { peerId } = useParams<{ peerId: string }>();
  const [searchParams] = useSearchParams();
  const role = searchParams.get('role') || 'caller'; // 'caller' | 'callee'
  const navigate = useNavigate();
  const { user } = useAuth();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const transcriptionRef = useRef<TranscriptionService | null>(null);

  const [localText, setLocalText] = useState('');
  const [remoteText, setRemoteText] = useState('');
  const [remoteLang, setRemoteLang] = useState('');
  const [callStatus, setCallStatus] = useState<string>(
    role === 'caller' ? 'Connecting...' : 'Answering...',
  );
  const [callActive, setCallActive] = useState(false);

  const { controlsHidden, showControls } = useAutoHideControls();
  const { isMuted, isCameraOff, toggleMute, toggleCamera } = useMediaToggles(localStreamRef);
  const { savedWordsSet, isWordSaved, addWord } = useSavedWords();

  // ---- Shared cleanup helper ---------------------------------------------

  const cleanup = useCallback(({ skipTranscription = false } = {}) => {
    if (!skipTranscription && transcriptionRef.current) {
      transcriptionRef.current.stop();
      transcriptionRef.current = null;
    }
    if (pcRef.current) {
      closePeerConnection(pcRef.current);
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
  }, []);

  // ---- End call ----------------------------------------------------------

  const endCall = useCallback(() => {
    socket.emit('call:end', { peerId });
    cleanup();
    navigate('/');
  }, [peerId, navigate, cleanup]);

  // ---- Setup call + socket handlers (single effect) ----------------------

  useEffect(() => {
    let cleaned = false;

    // --- Socket event handlers (registered first so nothing is missed) ---

    const onCallAccepted = async () => {
      if (role !== 'caller') return;
      // Wait until PC is ready (setupCall may still be running)
      if (!pcRef.current || !localStreamRef.current) {
        console.warn('[call] call:accepted arrived but PC not ready yet');
        return;
      }
      setCallStatus('Connecting...');
      try {
        const offer = await createOffer(pcRef.current, localStreamRef.current);
        socket.emit('signal:offer', { peerId, offer });
      } catch (err) {
        console.error('[call] Error creating offer:', err);
      }
    };

    const onSignalOffer = async (data: { offer: RTCSessionDescriptionInit; fromUserId: string }) => {
      if (role !== 'callee') return;
      if (!pcRef.current || !localStreamRef.current) {
        console.warn('[call] signal:offer arrived but PC not ready yet');
        return;
      }
      try {
        const answer = await createAnswer(pcRef.current, data.offer, localStreamRef.current);
        socket.emit('signal:answer', { peerId, answer });
        setCallActive(true);
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
        setCallActive(true);
        setCallStatus('');
      } catch (err) {
        console.error('[call] Error setting remote description:', err);
      }
    };

    const onIceCandidate = (data: { candidate: RTCIceCandidateInit }) => {
      if (!pcRef.current) return;
      addIceCandidate(pcRef.current, data.candidate);
    };

    const onCallEnded = () => {
      setCallStatus('Call ended');
      cleanup();
      setTimeout(() => navigate('/'), 1500);
    };

    const onCallRejected = () => {
      setCallStatus('Call rejected');
      cleanup({ skipTranscription: true });
      setTimeout(() => navigate('/'), 1500);
    };

    const onTranscript = (data: { text: string; lang: string; userId: number }) => {
      console.log('[call] transcript event:', data);
      if (data.userId === user?.id) {
        setLocalText(data.text);
      } else {
        setRemoteText(data.text);
        setRemoteLang(data.lang);
      }
    };

    socket.on('call:accepted', onCallAccepted);
    socket.on('signal:offer', onSignalOffer);
    socket.on('signal:answer', onSignalAnswer);
    socket.on('signal:ice-candidate', onIceCandidate);
    socket.on('call:ended', onCallEnded);
    socket.on('call:rejected', onCallRejected);
    socket.on('transcript', onTranscript);

    // --- Async setup (media + peer connection) ---

    async function setupCall() {
      try {
        // 1. Get local media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (cleaned) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // 2. Create peer connection
        const pc = createPeerConnection(
          // onTrack -- remote media
          (event) => {
            if (remoteVideoRef.current && event.streams[0]) {
              remoteVideoRef.current.srcObject = event.streams[0];
            }
            setCallActive(true);
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
        );

        if (cleaned) {
          closePeerConnection(pc);
          return;
        }
        pcRef.current = pc;

        // 3. Role-based signaling
        if (role === 'caller') {
          socket.emit('call:initiate', { peerId });
          setCallStatus('Ringing...');
        } else {
          // Callee: PC is ready, now tell the caller we accepted.
          socket.emit('call:accept', { callerId: peerId });
          setCallStatus('Waiting for connection...');
        }

        // 4. Start transcription (Voxtral via server relay)
        const ts = new TranscriptionService(peerId!);
        transcriptionRef.current = ts;
        ts.start(stream);
      } catch (err) {
        console.error('[call] Setup error:', err);
        setCallStatus('Failed to access camera/microphone');
      }
    }

    setupCall();

    return () => {
      cleaned = true;

      socket.off('call:accepted', onCallAccepted);
      socket.off('signal:offer', onSignalOffer);
      socket.off('signal:answer', onSignalAnswer);
      socket.off('signal:ice-candidate', onIceCandidate);
      socket.off('call:ended', onCallEnded);
      socket.off('call:rejected', onCallRejected);
      socket.off('transcript', onTranscript);

      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId, role]);

  // ---- Render ------------------------------------------------------------

  return (
    <div
      className={`call-page${controlsHidden ? ' controls-hidden' : ''}`}
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
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

      {/* Subtitle bar */}
      <SubtitleBar localText={localText} remoteText={remoteText} remoteLang={remoteLang} nativeLang={user?.native_language || undefined} savedWords={savedWordsSet} isWordSaved={isWordSaved} onSaveWord={addWord} />

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
  );
}
