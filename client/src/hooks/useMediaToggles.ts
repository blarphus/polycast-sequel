import { useState, useCallback } from 'react';

/**
 * Provides mute/camera toggle callbacks that operate on a MediaStream ref.
 */
export function useMediaToggles(streamRef: React.RefObject<MediaStream | null>) {
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  const toggleMute = useCallback(() => {
    if (!streamRef.current) return;
    const audioTrack = streamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  }, [streamRef]);

  const toggleCamera = useCallback(() => {
    if (!streamRef.current) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsCameraOff(!videoTrack.enabled);
    }
  }, [streamRef]);

  return { isMuted, isCameraOff, toggleMute, toggleCamera };
}
