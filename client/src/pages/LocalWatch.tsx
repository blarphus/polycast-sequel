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
import { getLocalVideo } from '../utils/localVideoStore';
import { parseSrt } from '../utils/srtParser';
import { FullscreenIcon, FullscreenExitIcon } from '../components/icons';

export default function LocalWatch() {
  const { filename } = useParams<{ filename: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [popup, setPopup] = useState<PopupState | null>(null);
  const wasPlayingRef = useRef(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [rawSegments, setRawSegments] = useState<{ text: string; offset: number; duration: number }[]>([]);
  const [error, setError] = useState('');

  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord, addOptimistic } = useSavedWords();

  const decodedFilename = filename ? decodeURIComponent(filename) : '';

  // Load video + SRT on mount
  useEffect(() => {
    const entry = getLocalVideo(decodedFilename);
    if (!entry) {
      setError('Video not found. Go back and re-select the folder.');
      return;
    }

    const url = URL.createObjectURL(entry.videoFile);
    setVideoUrl(url);

    if (entry.srtFile) {
      entry.srtFile.text().then((content) => {
        setRawSegments(parseSrt(content));
      });
    }

    return () => URL.revokeObjectURL(url);
  }, [decodedFilename]);

  const mergedSegments = useMemo(
    () => mergeTranscriptSegmentsForDisplay(rawSegments),
    [rawSegments],
  );

  const fullscreenRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreen(fullscreenRef);

  const { videoRef, activeIndex, seekToOffset } = useLocalVideoPlayer(videoUrl, mergedSegments);

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

        {/* Fullscreen subtitle overlay */}
        {isFullscreen && activeIndex >= 0 && mergedSegments[activeIndex] && (
          <div className="local-watch-subtitle-overlay">
            <span className="subtitle-text">
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
