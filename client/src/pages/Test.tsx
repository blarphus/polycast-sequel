// ---------------------------------------------------------------------------
// pages/Test.tsx -- Solo test mode for camera + Voxtral transcription
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { useAuth } from '../hooks/useAuth';
import { TranscriptionService } from '../transcription';
import SubtitleBar from '../components/SubtitleBar';
import CallControls, { BackIcon } from '../components/CallControls';

export default function Test() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptionRef = useRef<TranscriptionService | null>(null);

  const [localText, setLocalText] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showControls = useCallback(() => {
    setControlsHidden(false);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsHidden(true), 3000);
  }, []);

  useEffect(() => {
    hideTimerRef.current = setTimeout(() => setControlsHidden(true), 3000);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const goBack = useCallback(() => {
    if (transcriptionRef.current) {
      transcriptionRef.current.stop();
      transcriptionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    navigate('/');
  }, [navigate]);

  const toggleMute = useCallback(() => {
    if (!streamRef.current) return;
    const audioTrack = streamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  }, []);

  const toggleCamera = useCallback(() => {
    if (!streamRef.current) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsCameraOff(!videoTrack.enabled);
    }
  }, []);

  useEffect(() => {
    let cleaned = false;

    const onTranscript = (data: { text: string; lang: string; userId: number }) => {
      if (data.userId === user?.id) {
        setLocalText(data.text);
      }
    };

    socket.on('transcript', onTranscript);

    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (cleaned) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        const ts = new TranscriptionService('__test__');
        transcriptionRef.current = ts;
        ts.start(stream);
      } catch (err) {
        console.error('[test] Setup error:', err);
      }
    }

    setup();

    return () => {
      cleaned = true;
      socket.off('transcript', onTranscript);

      if (transcriptionRef.current) {
        transcriptionRef.current.stop();
        transcriptionRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`call-page${controlsHidden ? ' controls-hidden' : ''}`}
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
      <video
        ref={videoRef}
        className="test-self-video"
        autoPlay
        playsInline
        muted
      />

      <div className="test-label">Test Mode</div>

      <SubtitleBar localText={localText} remoteText="" remoteLang="" />

      <CallControls
        isMuted={isMuted}
        isCameraOff={isCameraOff}
        onToggleMute={toggleMute}
        onToggleCamera={toggleCamera}
        primaryAction={{
          label: 'Back to Home',
          icon: <BackIcon />,
          onClick: goBack,
          variant: 'secondary',
        }}
      />
    </div>
  );
}
