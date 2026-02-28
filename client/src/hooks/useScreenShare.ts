// ---------------------------------------------------------------------------
// hooks/useScreenShare.ts -- Screen sharing via getDisplayMedia + replaceTrack
// ---------------------------------------------------------------------------

import { useRef, useState, useEffect, useCallback } from 'react';

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
        videoSender.replaceTrack(originalVideoTrack).catch(err => {
          console.error('[screenShare] Failed to restore video track:', err);
        });
      }

      const audioSender = senders.find(s => s.track?.kind === 'audio');
      const originalAudioTrack = stream.getAudioTracks()[0] ?? null;
      if (audioSender && originalAudioTrack) {
        audioSender.replaceTrack(originalAudioTrack).catch(err => {
          console.error('[screenShare] Failed to restore audio track:', err);
        });
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
    } catch (err) {
      console.error('[screenShare] getDisplayMedia cancelled or failed:', err);
      return;
    }

    const pc = pcRef.current;
    if (!pc) {
      console.error('[screenShare] No peer connection available');
      screenStream.getTracks().forEach(t => t.stop());
      return;
    }

    const senders = pc.getSenders();
    const screenVideoTrack = screenStream.getVideoTracks()[0] ?? null;
    const screenAudioTrack = screenStream.getAudioTracks()[0] ?? null;

    if (screenVideoTrack) {
      const videoSender = senders.find(s => s.track?.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(screenVideoTrack).catch(err => {
          console.error('[screenShare] Failed to replace video track:', err);
        });
      }
    }

    if (screenAudioTrack) {
      const audioSender = senders.find(s => s.track?.kind === 'audio');
      if (audioSender) {
        audioSender.replaceTrack(screenAudioTrack).catch(err => {
          console.error('[screenShare] Failed to replace audio track:', err);
        });
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
