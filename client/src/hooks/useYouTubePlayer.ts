import { useEffect, useRef, useState } from 'react';
import type { TranscriptSegment, VideoDetail } from '../api';

declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

declare namespace YT {
  class Player {
    constructor(el: string | HTMLElement, opts: PlayerOptions);
    getCurrentTime(): number;
    seekTo(seconds: number, allowSeekAhead?: boolean): void;
    destroy(): void;
  }
  interface PlayerOptions {
    videoId: string;
    playerVars?: Record<string, number | string>;
    events?: {
      onReady?: (e: { target: Player }) => void;
      onStateChange?: (e: { data: number }) => void;
    };
  }
  const PlayerState: {
    PLAYING: number;
    PAUSED: number;
    ENDED: number;
  };
}

export function useYouTubePlayer(video: VideoDetail | null, mergedSegments: TranscriptSegment[]) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const [videoEnded, setVideoEnded] = useState(false);
  const playerRef = useRef<YT.Player | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mergedSegmentsRef = useRef(mergedSegments);
  mergedSegmentsRef.current = mergedSegments;

  useEffect(() => {
    if (!video) return;

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const startPolling = () => {
      stopPolling();
      intervalRef.current = setInterval(() => {
        if (!playerRef.current) return;
        const currentMs = playerRef.current.getCurrentTime() * 1000;
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
      }, 250);
    };

    const loadApi = () => {
      if (document.getElementById('yt-iframe-api')) return;
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    };

    const initPlayer = () => {
      if (playerRef.current) return;
      playerRef.current = new window.YT.Player('yt-player', {
        videoId: video.youtube_id,
        playerVars: {
          cc_load_policy: 0,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            startPolling();
          },
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.PLAYING) {
              startPolling();
              setVideoEnded(false);
            } else if (e.data === window.YT.PlayerState.ENDED) {
              stopPolling();
              setVideoEnded(true);
            } else {
              stopPolling();
            }
          },
        },
      });
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
      loadApi();
    }

    return () => {
      stopPolling();
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      window.onYouTubeIframeAPIReady = undefined;
    };
  }, [video]);

  const seekToOffset = (offset: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(offset / 1000, true);
    }
  };

  return {
    activeIndex,
    videoEnded,
    seekToOffset,
  };
}
