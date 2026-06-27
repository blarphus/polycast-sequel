import { useCallback, useEffect, useRef, useState } from 'react';

export type LocalMediaStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable' | 'error';

export interface LocalMediaError {
  title: string;
  message: string;
}

function describeMediaError(err: unknown): { status: LocalMediaStatus; error: LocalMediaError } {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      return {
        status: 'denied',
        error: {
          title: 'Camera or microphone blocked',
          message: 'Allow camera and microphone access, then try joining the call again.',
        },
      };
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return {
        status: 'unavailable',
        error: {
          title: 'Camera or microphone unavailable',
          message: 'Polycast could not find the camera or microphone needed for this call.',
        },
      };
    }
  }

  return {
    status: 'error',
    error: {
      title: 'Could not start media',
      message: err instanceof Error ? err.message : 'Camera and microphone setup failed.',
    },
  };
}

export function useLocalMedia(constraints: MediaStreamConstraints = { video: true, audio: true }) {
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const constraintsRef = useRef(constraints);
  const [status, setStatus] = useState<LocalMediaStatus>('idle');
  const [error, setError] = useState<LocalMediaError | null>(null);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return streamRef.current;
    setStatus('requesting');
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraintsRef.current);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStatus('ready');
      return stream;
    } catch (err) {
      console.error('[media] getUserMedia failed:', err);
      const described = describeMediaError(err);
      setStatus(described.status);
      setError(described.error);
      throw err;
    }
  }, []);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return {
    streamRef,
    videoRef,
    status,
    error,
    streamReady: status === 'ready',
    start,
    stop,
  };
}
