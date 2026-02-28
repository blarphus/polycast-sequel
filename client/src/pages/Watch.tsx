// ---------------------------------------------------------------------------
// pages/Watch.tsx -- YouTube video player with synced clickable transcript
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import { getVideo, retryVideoTranscript, VideoDetail } from '../api';
import TokenizedText from '../components/TokenizedText';
import WordPopup from '../components/WordPopup';
import { PopupState } from '../textTokens';

// Minimal YT IFrame API type declarations
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

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Watch() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [retryingTranscript, setRetryingTranscript] = useState(false);

  const playerRef = useRef<YT.Player | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord } = useSavedWords();

  // Keep the watch page pinned to viewport height so transcript scrolling
  // remains inside the transcript container (not the document body).
  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, []);

  // Fetch video data
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    getVideo(id)
      .then((v) => { if (!cancelled) setVideo(v); })
      .catch((err) => {
        console.error('Failed to fetch video:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  // Poll while transcript extraction is running in the background.
  useEffect(() => {
    if (!id || !video || video.transcript_status !== 'processing') return;

    const timer = setInterval(() => {
      getVideo(id)
        .then((v) => setVideo(v))
        .catch((err) => {
          console.error('Failed to refresh video transcript status:', err);
        });
    }, 4000);

    return () => clearInterval(timer);
  }, [id, video?.transcript_status]);

  // Load YouTube IFrame API
  useEffect(() => {
    if (!video) return;

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
            } else {
              stopPolling();
            }
          },
        },
      });
    };

    const startPolling = () => {
      stopPolling();
      intervalRef.current = setInterval(() => {
        if (!playerRef.current) return;
        const currentMs = playerRef.current.getCurrentTime() * 1000;
        if (!video.transcript || video.transcript.length === 0) return;

        let idx = -1;
        for (let i = video.transcript.length - 1; i >= 0; i--) {
          if (video.transcript[i].offset <= currentMs) {
            idx = i;
            break;
          }
        }
        setActiveIndex(idx);
      }, 250);
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
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

  // Auto-scroll to active segment (inside transcript container only).
  useEffect(() => {
    if (activeIndex < 0 || !autoScrollRef.current) return;
    const container = transcriptRef.current;
    const el = segmentRefs.current[activeIndex];
    if (!container || !el) return;

    const targetTop = el.offsetTop - (container.clientHeight / 2) + (el.clientHeight / 2);
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    });
  }, [activeIndex]);

  // Track manual scroll to disable auto-scroll
  const handleTranscriptScroll = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const activeEl = segmentRefs.current[activeIndex];
    if (!activeEl) return;
    const threshold = 120;
    const visible =
      activeEl.offsetTop >= el.scrollTop - threshold &&
      (activeEl.offsetTop + activeEl.clientHeight) <= (el.scrollTop + el.clientHeight + threshold);
    autoScrollRef.current = visible;
  }, [activeIndex]);

  const handleTimestampClick = (offset: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(offset / 1000, true);
      autoScrollRef.current = true;
    }
  };

  const handleWordClick = (e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({ word, sentence, rect });
  };

  const handleRetryTranscript = async () => {
    if (!id) return;
    setRetryingTranscript(true);
    try {
      const updated = await retryVideoTranscript(id);
      setVideo(updated);
    } catch (err) {
      console.error('Failed to retry transcript fetch:', err);
    } finally {
      setRetryingTranscript(false);
    }
  };

  if (loading) {
    return (
      <div className="watch-page">
        <div className="loading-screen">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="watch-page">
        <p className="auth-error" style={{ margin: '2rem 0' }}>{error}</p>
        <button className="btn-primary" onClick={() => navigate('/')}>Back to Home</button>
      </div>
    );
  }

  if (!video) return null;
  const hasTranscript = Array.isArray(video.transcript) && video.transcript.length > 0;

  return (
    <div className="watch-page">
      {/* YouTube Player */}
      <div className="watch-player-wrapper">
        <div id="yt-player" />
      </div>

      {/* Video info */}
      <div className="watch-info">
        <h1 className="watch-title">{video.title}</h1>
        <p className="watch-channel">{video.channel}</p>
      </div>

      {/* Transcript lifecycle status */}
      {!hasTranscript && video.transcript_status === 'processing' && (
        <p className="watch-transcript-status">Captions are being fetched. This page will update automatically.</p>
      )}
      {!hasTranscript && video.transcript_status === 'failed' && (
        <div className="watch-transcript-error-wrap">
          <p className="watch-transcript-error">{video.transcript_error || 'Transcript temporarily unavailable'}</p>
          <button className="btn-primary" onClick={handleRetryTranscript} disabled={retryingTranscript}>
            {retryingTranscript ? 'Retrying...' : 'Retry transcript fetch'}
          </button>
        </div>
      )}

      {/* Transcript */}
      {hasTranscript && (
        <div
          className="watch-transcript"
          ref={transcriptRef}
          onScroll={handleTranscriptScroll}
        >
          {video.transcript.map((seg, i) => (
            <div
              key={i}
              ref={(el) => { segmentRefs.current[i] = el; }}
              className={`watch-segment${i === activeIndex ? ' watch-segment--active' : ''}`}
            >
              <button
                className="watch-segment-time"
                onClick={() => handleTimestampClick(seg.offset)}
              >
                {formatTimestamp(seg.offset)}
              </button>
              <span className="watch-segment-text">
                <TokenizedText
                  text={seg.text}
                  savedWords={savedWordsSet}
                  onWordClick={handleWordClick}
                />
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Word popup */}
      {popup && user && (
        <WordPopup
          word={popup.word}
          sentence={popup.sentence}
          nativeLang={user.native_language || 'en'}
          targetLang={user.target_language || undefined}
          anchorRect={popup.rect}
          onClose={() => setPopup(null)}
          isWordSaved={isWordSaved}
          isDefinitionSaved={isDefinitionSaved}
          onSaveWord={addWord}
        />
      )}
    </div>
  );
}
