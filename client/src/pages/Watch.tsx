// ---------------------------------------------------------------------------
// pages/Watch.tsx -- YouTube video player with synced clickable transcript
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import TranscriptList from '../components/watch/TranscriptList';
import TranscriptStatus from '../components/watch/TranscriptStatus';
import WordPopup from '../components/WordPopup';
import { PopupState } from '../textTokens';
import { TargetIcon } from '../components/icons';
import { useTranscriptAutoScroll } from '../hooks/useTranscriptAutoScroll';
import { useWatchVideoData } from '../hooks/useWatchVideoData';
import { useYouTubePlayer } from '../hooks/useYouTubePlayer';
import { mergeTranscriptSegmentsForDisplay } from '../watchTranscript';

export default function Watch() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [popup, setPopup] = useState<PopupState | null>(null);

  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord } = useSavedWords();
  const {
    video,
    loading,
    error,
    retryingTranscript,
    handleRetryTranscript,
    hasTranscript,
  } = useWatchVideoData(id);

  const mergedSegments = useMemo(
    () => mergeTranscriptSegmentsForDisplay(video?.transcript ?? []),
    [video?.transcript],
  );
  const { activeIndex, videoEnded, seekToOffset } = useYouTubePlayer(video, mergedSegments);
  const {
    transcriptRef,
    segmentRefs,
    showScrollBtn,
    handleTranscriptScroll,
    handleResumeAutoScroll,
    resetAutoScroll,
  } = useTranscriptAutoScroll(activeIndex);

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

  const handleTimestampClick = (offset: number) => {
    seekToOffset(offset);
    resetAutoScroll();
  };

  const handleWordClick = (e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({ word, sentence, rect });
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

  return (
    <div className="watch-page">
      <div className="watch-topbar">
        <button
          className="watch-back-btn"
          onClick={() => navigate('/')}
          aria-label="Back to home"
        >
          <span className="watch-back-arrow" aria-hidden="true">←</span>
          <span>Back</span>
        </button>
      </div>

      {/* YouTube Player */}
      <div className="watch-player-wrapper">
        <div id="yt-player" />
      </div>

      {/* Video info */}
      <div className="watch-info">
        <h1 className="watch-title">{video.title}</h1>
        <p className="watch-channel">{video.channel}</p>
      </div>

      <div className="watch-transcript-area">
        <TranscriptStatus
          video={video}
          hasTranscript={hasTranscript}
          retryingTranscript={retryingTranscript}
          onRetryTranscript={handleRetryTranscript}
        />

        {hasTranscript && (
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

      {/* Practice prompt (shown when video ends) */}
      {videoEnded && video && video.transcript_status === 'ready' && (
        <div className="watch-practice-prompt">
          <TargetIcon size={20} />
          <p>Ready to practice?</p>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/practice/${video.id}`)}>
            Start Quiz
          </button>
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
