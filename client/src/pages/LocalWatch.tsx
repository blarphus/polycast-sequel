// ---------------------------------------------------------------------------
// pages/LocalWatch.tsx — Watch a local video with synced SRT transcript
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import { useFullscreen } from '../hooks/useFullscreen';
import TranscriptList from '../components/watch/TranscriptList';
import TokenizedText from '../components/TokenizedText';
import WordPopup from '../components/WordPopup';
import { PopupState } from '../textTokens';
import { useTranscriptAutoScroll } from '../hooks/useTranscriptAutoScroll';
import { useLocalVideoPlayer } from '../hooks/useLocalVideoPlayer';
import { mergeTranscriptSegmentsForDisplay } from '../watchTranscript';
import { getLocalVideo, loadDirHandle, loadFromDirHandle, getVideoProgress } from '../utils/localVideoStore';
import { parseSrt } from '../utils/srtParser';
import { FullscreenIcon, FullscreenExitIcon } from '../components/icons';

export default function LocalWatch() {
  const { filename } = useParams<{ filename: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [popup, setPopup] = useState<PopupState | null>(null);
  const wasPlayingRef = useRef(false);
  const SUBTITLE_SIZES = [1.2, 1.5, 1.8, 2.2, 2.8, 3.4];
  const [subtitleSizeIdx, setSubtitleSizeIdx] = useState(2); // default 1.8rem
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [rawSegments, setRawSegments] = useState<{ text: string; offset: number; duration: number }[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord, addOptimistic } = useSavedWords();

  const decodedFilename = filename ? decodeURIComponent(filename) : '';

  // Load video + SRT on mount (try restoring from IndexedDB if needed)
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const loadVideo = async () => {
      let entry = getLocalVideo(decodedFilename);

      // Try restoring from saved directory handle
      if (!entry) {
        const handle = await loadDirHandle();
        if (handle && !cancelled) {
          try {
            await loadFromDirHandle(handle);
            entry = getLocalVideo(decodedFilename);
          } catch (err) {
            console.error('Failed to restore directory:', err);
          }
        }
      }

      if (cancelled) return;

      if (!entry) {
        setError('Video not found. Go back and re-select the folder.');
        setLoading(false);
        return;
      }

      objectUrl = URL.createObjectURL(entry.videoFile);
      setVideoUrl(objectUrl);

      if (entry.srtFile) {
        entry.srtFile.text().then((content) => {
          if (!cancelled) setRawSegments(parseSrt(content));
        });
      }

      setLoading(false);
    };

    loadVideo();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [decodedFilename]);

  const mergedSegments = useMemo(
    () => mergeTranscriptSegmentsForDisplay(rawSegments),
    [rawSegments],
  );

  const fullscreenRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreen(fullscreenRef);

  const { videoRef, activeIndex, seekToOffset } = useLocalVideoPlayer(videoUrl, mergedSegments, decodedFilename);

  // Resume from saved progress
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    const prog = getVideoProgress(decodedFilename);
    if (prog && prog.currentTime > 0 && !prog.completed) {
      const onReady = () => {
        video.currentTime = prog.currentTime;
        video.removeEventListener('loadedmetadata', onReady);
      };
      if (video.readyState >= 1) {
        video.currentTime = prog.currentTime;
      } else {
        video.addEventListener('loadedmetadata', onReady);
        return () => video.removeEventListener('loadedmetadata', onReady);
      }
    }
  }, [videoUrl, decodedFilename]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    transcriptRef,
    segmentRefs,
    showScrollBtn,
    handleTranscriptScroll,
    handleResumeAutoScroll,
    resetAutoScroll,
  } = useTranscriptAutoScroll(activeIndex);

  // Intercept native video fullscreen → redirect to container fullscreen
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleFullscreenChange = () => {
      if (document.fullscreenElement === video) {
        document.exitFullscreen().then(() => {
          fullscreenRef.current?.requestFullscreen();
        });
      }
    };

    video.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => video.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [videoUrl]);

  // Lock page scrolling
  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  const handleTimestampClick = (offset: number) => {
    seekToOffset(offset);
    resetAutoScroll();
  };

  const handleWordClick = (e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const video = videoRef.current;
    if (video && !video.paused) {
      wasPlayingRef.current = true;
      video.pause();
    }
    setPopup({ word, sentence, rect });
  };

  const handlePopupClose = () => {
    setPopup(null);
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false;
      videoRef.current?.play();
    }
  };

  if (loading) {
    return (
      <div className="watch-page">
        <p className="watch-transcript-status" style={{ margin: '2rem 0' }}>Loading video...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="watch-page">
        <p className="auth-error" style={{ margin: '2rem 0' }}>{error}</p>
        <button className="btn-primary" onClick={() => navigate('/local-videos')}>Back to Local Videos</button>
      </div>
    );
  }

  return (
    <div className="watch-page">
      <div className="watch-topbar">
        <button
          className="watch-back-btn"
          onClick={() => navigate('/local-videos')}
          aria-label="Back to local videos"
        >
          <span className="watch-back-arrow" aria-hidden="true">&larr;</span>
          <span>Back</span>
        </button>
      </div>

      {/* HTML5 Video Player with fullscreen container */}
      <div
        ref={fullscreenRef}
        className={`local-watch-fullscreen-container${isFullscreen ? ' fullscreen' : ''}`}
      >
        <div className="watch-player-wrapper">
          {videoUrl && (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="local-video-player"
            />
          )}
        </div>

        <button
          className="local-watch-fullscreen-btn"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <FullscreenExitIcon size={20} /> : <FullscreenIcon size={20} />}
        </button>

        {/* Subtitle size controls */}
        <div className="local-watch-subtitle-controls">
          <button
            className="local-watch-subtitle-size-btn"
            onClick={() => setSubtitleSizeIdx((i) => Math.max(0, i - 1))}
            disabled={subtitleSizeIdx === 0}
            aria-label="Decrease subtitle size"
          >
            A-
          </button>
          <button
            className="local-watch-subtitle-size-btn"
            onClick={() => setSubtitleSizeIdx((i) => Math.min(SUBTITLE_SIZES.length - 1, i + 1))}
            disabled={subtitleSizeIdx === SUBTITLE_SIZES.length - 1}
            aria-label="Increase subtitle size"
          >
            A+
          </button>
        </div>

        {/* Subtitle overlay (always visible over the video) */}
        {activeIndex >= 0 && mergedSegments[activeIndex] && (
          <div className="local-watch-subtitle-overlay">
            <span
              className="subtitle-text"
              style={{ fontSize: `${SUBTITLE_SIZES[subtitleSizeIdx]}rem` }}
            >
              <TokenizedText
                text={mergedSegments[activeIndex].text}
                savedWords={savedWordsSet}
                onWordClick={handleWordClick}
              />
            </span>
          </div>
        )}

        {/* Word popup (inside fullscreen container so it's visible in fullscreen) */}
        {popup && user && (
          <WordPopup
            word={popup.word}
            sentence={popup.sentence}
            nativeLang={user.native_language || 'en'}
            targetLang={user.target_language || undefined}
            anchorRect={popup.rect}
            onClose={handlePopupClose}
            isWordSaved={isWordSaved}
            isDefinitionSaved={isDefinitionSaved}
            onSaveWord={addWord}
            onOptimisticSave={addOptimistic}
          />
        )}
      </div>

      {/* Video info */}
      <div className="watch-info">
        <h1 className="watch-title">{decodedFilename}</h1>
        {rawSegments.length > 0 && (
          <p className="watch-channel">{rawSegments.length} subtitle segments loaded</p>
        )}
      </div>

      {/* Transcript */}
      <div className="watch-transcript-area">
        {rawSegments.length === 0 ? (
          <p className="watch-transcript-status">No SRT subtitle file found for this video.</p>
        ) : (
          <TranscriptList
            mergedSegments={mergedSegments}
            activeIndex={activeIndex}
            savedWords={savedWordsSet}
            onWordClick={handleWordClick}
            onTimestampClick={handleTimestampClick}
            transcriptRef={transcriptRef}
            segmentRefs={segmentRefs}
            showScrollBtn={showScrollBtn}
            onTranscriptScroll={handleTranscriptScroll}
            onResumeAutoScroll={handleResumeAutoScroll}
          />
        )}
      </div>
    </div>
  );
}
