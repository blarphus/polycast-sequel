// ---------------------------------------------------------------------------
// pages/LocalWatch.tsx — Watch a local video with synced SRT transcript
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import TranscriptList from '../components/watch/TranscriptList';
import WordPopup from '../components/WordPopup';
import { PopupState } from '../textTokens';
import { useTranscriptAutoScroll } from '../hooks/useTranscriptAutoScroll';
import { useLocalVideoPlayer } from '../hooks/useLocalVideoPlayer';
import { mergeTranscriptSegmentsForDisplay } from '../watchTranscript';
import { getLocalVideo } from '../utils/localVideoStore';
import { parseSrt } from '../utils/srtParser';

export default function LocalWatch() {
  const { filename } = useParams<{ filename: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [popup, setPopup] = useState<PopupState | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [rawSegments, setRawSegments] = useState<{ text: string; offset: number; duration: number }[]>([]);
  const [error, setError] = useState('');

  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord } = useSavedWords();

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

  const { videoRef, activeIndex, seekToOffset } = useLocalVideoPlayer(videoUrl, mergedSegments);

  const {
    transcriptRef,
    segmentRefs,
    showScrollBtn,
    handleTranscriptScroll,
    handleResumeAutoScroll,
    resetAutoScroll,
  } = useTranscriptAutoScroll(activeIndex);

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
    setPopup({ word, sentence, rect });
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

      {/* HTML5 Video Player */}
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
