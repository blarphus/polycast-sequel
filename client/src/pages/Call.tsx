// ---------------------------------------------------------------------------
// pages/Call.tsx -- Active call page with WebRTC, signaling, and transcription
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { useAuth } from '../hooks/useAuth';
import {
  createPeerConnection,
  createOffer,
  createAnswer,
  addIceCandidate,
  closePeerConnection,
} from '../webrtc';
import { TranscriptionService } from '../transcription';
import SubtitleBar from '../components/SubtitleBar';

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

  // Refs to hold latest state for use inside socket callbacks
  const peerIdRef = useRef(peerId);
  peerIdRef.current = peerId;

  // ---- End call ----------------------------------------------------------

  const endCall = useCallback(() => {
    // Notify peer
    socket.emit('call:end', { peerId });

    // Cleanup
    if (transcriptionRef.current) {
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

    navigate('/');
  }, [peerId, navigate]);

  // ---- Setup call --------------------------------------------------------

  useEffect(() => {
    let cleaned = false;

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
          // Caller: initiate call and send offer
          socket.emit('call:initiate', { peerId });
          setCallStatus('Ringing...');

          // Wait for acceptance before sending offer
          // The offer is sent when we receive `call:accepted`
        } else {
          // Callee: PC is ready, now tell the caller we accepted.
          // This ensures the offer won't arrive before we can handle it.
          socket.emit('call:accept', { callerId: peerId });
          setCallStatus('Waiting for connection...');
        }

        // 4. Start transcription
        const ts = new TranscriptionService((payload) => {
          setLocalText(payload.text);
          socket.emit('transcript', {
            text: payload.text,
            lang: payload.lang,
            userId: user?.id,
            peerId,
          });
        });
        transcriptionRef.current = ts;
        ts.start();
      } catch (err) {
        console.error('[call] Setup error:', err);
        setCallStatus('Failed to access camera/microphone');
      }
    }

    setupCall();

    return () => {
      cleaned = true;
      if (transcriptionRef.current) {
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId, role]);

  // ---- Socket event handlers ---------------------------------------------

  useEffect(() => {
    // Caller receives acceptance -- now send the offer
    const onCallAccepted = async (data: { callerId: string }) => {
      if (role !== 'caller') return;
      if (!pcRef.current || !localStreamRef.current) return;

      setCallStatus('Connecting...');
      try {
        const offer = await createOffer(pcRef.current, localStreamRef.current);
        socket.emit('signal:offer', { peerId, offer });
      } catch (err) {
        console.error('[call] Error creating offer:', err);
      }
    };

    // Callee receives the offer
    const onSignalOffer = async (data: { offer: RTCSessionDescriptionInit; callerId: string }) => {
      if (role !== 'callee') return;
      if (!pcRef.current || !localStreamRef.current) return;

      try {
        const answer = await createAnswer(pcRef.current, data.offer, localStreamRef.current);
        socket.emit('signal:answer', { peerId, answer });
        setCallActive(true);
        setCallStatus('');
      } catch (err) {
        console.error('[call] Error creating answer:', err);
      }
    };

    // Caller receives the answer
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

    // ICE candidates from either side
    const onIceCandidate = (data: { candidate: RTCIceCandidateInit }) => {
      if (!pcRef.current) return;
      addIceCandidate(pcRef.current, data.candidate);
    };

    // Peer ended the call
    const onCallEnded = () => {
      setCallStatus('Call ended');
      if (transcriptionRef.current) {
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
      // Brief delay so user sees the status
      setTimeout(() => navigate('/'), 1500);
    };

    // Peer rejected the call (caller only)
    const onCallRejected = () => {
      setCallStatus('Call rejected');
      if (pcRef.current) {
        closePeerConnection(pcRef.current);
        pcRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      setTimeout(() => navigate('/'), 1500);
    };

    // Remote transcripts
    const onTranscript = (data: { text: string; lang: string; userId: number }) => {
      if (data.userId !== user?.id) {
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

    return () => {
      socket.off('call:accepted', onCallAccepted);
      socket.off('signal:offer', onSignalOffer);
      socket.off('signal:answer', onSignalAnswer);
      socket.off('signal:ice-candidate', onIceCandidate);
      socket.off('call:ended', onCallEnded);
      socket.off('call:rejected', onCallRejected);
      socket.off('transcript', onTranscript);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId, role, navigate, user?.id]);

  // ---- Render ------------------------------------------------------------

  return (
    <div className="call-page">
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
      <SubtitleBar localText={localText} remoteText={remoteText} remoteLang={remoteLang} />

      {/* Controls */}
      <div className="call-controls">
        <button className="btn btn-danger btn-end-call" onClick={endCall}>
          End Call
        </button>
      </div>
    </div>
  );
}
