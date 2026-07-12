// ---------------------------------------------------------------------------
// hooks/useScreenShare.ts -- Screen sharing via getDisplayMedia + replaceTrack
// ---------------------------------------------------------------------------

import { useRef, useState, useEffect, useCallback } from 'react';
import { logRuntimeDiagnostic } from '../utils/runtimeDiagnostics';

function reportScreenShareFailure(operation: string, error: unknown) {
  logRuntimeDiagnostic({
    code: 'screen_share_pipeline_failed',
    severity: 'error',
    source: 'web.call',
    operation,
    message: 'Screen sharing could not update the active call media pipeline.',
    detail: error,
    visible: true,
  });
}

export function useScreenShare(
  streamRef: React.RefObject<MediaStream | null>,
  pcRef: React.RefObject<RTCPeerConnection | null>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
): { isScreenSharing: boolean; toggleScreenShare: () => void } {
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const stopScreenShare = useCallback(() => {
    if (!screenStreamRef.current) return;

    screenStreamRef.current.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;

    const pc = pcRef.current;
    const stream = streamRef.current;

    if (pc && stream) {
      const senders = pc.getSenders();

      const videoSender = senders.find(s => s.track?.kind === 'video');
      const originalVideoTrack = stream.getVideoTracks()[0] ?? null;
      if (videoSender) {
        videoSender.replaceTrack(originalVideoTrack).catch(error => reportScreenShareFailure('restore-video-track', error));
      }

      const audioSender = senders.find(s => s.track?.kind === 'audio');
      const originalAudioTrack = stream.getAudioTracks()[0] ?? null;
      if (audioSender && originalAudioTrack) {
        audioSender.replaceTrack(originalAudioTrack).catch(error => reportScreenShareFailure('restore-audio-track', error));
      }
    }

    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }

    setIsScreenSharing(false);
  }, [pcRef, streamRef, videoRef]);

  const startScreenShare = useCallback(async () => {
    let screenStream: MediaStream;
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      reportScreenShareFailure('request-display-media', error);
      return;
    }

    const pc = pcRef.current;
    if (!pc) {
      reportScreenShareFailure('replace-call-media', 'No active peer connection was available');
      screenStream.getTracks().forEach(t => t.stop());
      return;
    }

    const senders = pc.getSenders();
    const screenVideoTrack = screenStream.getVideoTracks()[0] ?? null;
    const screenAudioTrack = screenStream.getAudioTracks()[0] ?? null;

    if (screenVideoTrack) {
      const videoSender = senders.find(s => s.track?.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(screenVideoTrack).catch(error => reportScreenShareFailure('share-video-track', error));
      }
    }

    if (screenAudioTrack) {
      const audioSender = senders.find(s => s.track?.kind === 'audio');
      if (audioSender) {
        audioSender.replaceTrack(screenAudioTrack).catch(error => reportScreenShareFailure('share-audio-track', error));
      }
    }

    if (videoRef.current) {
      videoRef.current.srcObject = screenStream;
    }

    screenStreamRef.current = screenStream;
    setIsScreenSharing(true);

    screenVideoTrack?.addEventListener('ended', () => stopScreenShare());
  }, [pcRef, videoRef, stopScreenShare]);

  const toggleScreenShare = useCallback(() => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  }, [isScreenSharing, startScreenShare, stopScreenShare]);

  useEffect(() => {
    return () => {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return { isScreenSharing, toggleScreenShare };
}
