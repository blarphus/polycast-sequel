// ---------------------------------------------------------------------------
// hooks/useLocalVideoPlayer.ts — HTML5 <video> player with transcript sync
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '../api';
import { saveVideoProgress } from '../utils/localVideoStore';

export function useLocalVideoPlayer(
  videoUrl: string | null,
  mergedSegments: TranscriptSegment[],
  videoName?: string,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [videoEnded, setVideoEnded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mergedSegmentsRef = useRef(mergedSegments);
  const lastSaveRef = useRef(0);
  mergedSegmentsRef.current = mergedSegments;

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    intervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const currentMs = video.currentTime * 1000;
      const segments = mergedSegmentsRef.current;
      if (segments.length === 0) return;

      let idx = -1;
      for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i].offset <= currentMs) {
          idx = i;
          break;
        }
      }
      setActiveIndex(idx);

      // Save progress every 5 seconds
      if (videoName && video.duration) {
        const now = Date.now();
        if (now - lastSaveRef.current > 5000) {
          saveVideoProgress(videoName, video.currentTime, video.duration);
          lastSaveRef.current = now;
        }
      }
    }, 250);
  }, [stopPolling, videoName]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    const onPlay = () => {
      startPolling();
      setVideoEnded(false);
    };
    const onPause = () => {
      stopPolling();
      if (videoName && video.duration) {
        saveVideoProgress(videoName, video.currentTime, video.duration);
      }
    };
    const onEnded = () => {
      stopPolling();
      setVideoEnded(true);
      if (videoName && video.duration) {
        saveVideoProgress(videoName, video.duration, video.duration);
      }
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);

    return () => {
      stopPolling();
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, [videoUrl, startPolling, stopPolling, videoName]);

  const seekToOffset = useCallback((offset: number) => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = offset / 1000;
    }
  }, []);

  return {
    videoRef,
    activeIndex,
    videoEnded,
    seekToOffset,
  };
}
