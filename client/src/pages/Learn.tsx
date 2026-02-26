// ---------------------------------------------------------------------------
// pages/Learn.tsx -- Flashcard-based SRS study page (Correct / Incorrect)
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDueWords, reviewWord, type SavedWord, type SrsAnswer } from '../api';
import { getButtonTimeLabel, getNextDueSeconds } from '../utils/srs';
import { renderTildeHighlight, renderCloze, stripTildes } from '../utils/tildeMarkup';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Learn() {
  const navigate = useNavigate();

  // Card queue
  const [cards, setCards] = useState<SavedWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);

  // Card state
  const [isFlipped, setIsFlipped] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [exitDirection, setExitDirection] = useState<'left' | 'right'>('right');
  const [isEntering, setIsEntering] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Feedback overlay
  const [feedback, setFeedback] = useState<{ answer: SrsAnswer; text: string } | null>(null);

  // Drag / swipe
  const [dragState, setDragState] = useState({ isDragging: false, deltaX: 0, startX: 0, startTime: 0 });

  // Session stats
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, correct: 0, incorrect: 0 });
  const sessionStartRef = useRef(Date.now());

  // Audio played tracker (once per card)
  const audioPlayedRef = useRef<Set<number>>(new Set());

  // Holds the API response so the re-queue timeout can use the updated card
  const reviewedCardRef = useRef<SavedWord | null>(null);

  // Fetch due words
  useEffect(() => {
    getDueWords()
      .then((data) => {
        setCards(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch due words:', err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const currentCard = cards[currentIndex];

  // ---------------------------------------------------------------------------
  // Audio playback (Web Speech API)
  // ---------------------------------------------------------------------------

  const playAudio = useCallback((text: string, lang?: string | null) => {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (lang) utterance.lang = lang;
    speechSynthesis.speak(utterance);
  }, []);

  // Auto-play on flip (once per card)
  useEffect(() => {
    if (!isFlipped || !currentCard) return;
    if (audioPlayedRef.current.has(currentIndex)) return;
    audioPlayedRef.current.add(currentIndex);

    const textToSpeak = currentCard.example_sentence
      ? stripTildes(currentCard.example_sentence)
      : currentCard.word;
    playAudio(textToSpeak, currentCard.target_language);
  }, [isFlipped, currentIndex, currentCard, playAudio]);

  // ---------------------------------------------------------------------------
  // Answer handling
  // ---------------------------------------------------------------------------

  const handleAnswer = useCallback(async (answer: SrsAnswer) => {
    if (!currentCard || submitting) return;
    setSubmitting(true);

    const timeLabel = getButtonTimeLabel(currentCard, answer);
    setFeedback({ answer, text: timeLabel });

    // Update stats
    setSessionStats((prev) => ({
      reviewed: prev.reviewed + 1,
      correct: prev.correct + (answer !== 'again' ? 1 : 0),
      incorrect: prev.incorrect + (answer === 'again' ? 1 : 0),
    }));

    // Check if this card should re-appear this session (learning-phase cards ≤ 10min)
    const nextDueSeconds = getNextDueSeconds(currentCard, answer);
    const requeue = nextDueSeconds <= 600;

    // Call API — store response for re-queue
    reviewedCardRef.current = null;
    reviewWord(currentCard.id, answer)
      .then((updated) => { reviewedCardRef.current = updated; })
      .catch((err) => { console.error('Review API error:', err); });

    // Animate exit → next card (wrong = left, right = correct)
    setExitDirection(answer === 'again' ? 'left' : 'right');
    setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => {
        setFeedback(null);
        setIsExiting(false);
        setIsFlipped(false);
        setDragState({ isDragging: false, deltaX: 0, startX: 0, startTime: 0 });

        // Re-queue short-interval cards with updated state from API
        if (requeue) {
          const updated = reviewedCardRef.current;
          reviewedCardRef.current = null;
          setCards((prev) => [...prev, { ...(updated ?? currentCard) }]);
        }

        setCurrentIndex((i) => i + 1);
        setIsEntering(true);
        setSubmitting(false);
        setTimeout(() => setIsEntering(false), 350);
      }, 300);
    }, 700);
  }, [currentCard, submitting]);

  // ---------------------------------------------------------------------------
  // Touch / swipe gestures
  // ---------------------------------------------------------------------------

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    setDragState({
      isDragging: true,
      deltaX: 0,
      startX: e.touches[0].clientX,
      startTime: Date.now(),
    });
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragState.isDragging) return;
    const deltaX = e.touches[0].clientX - dragState.startX;
    setDragState((prev) => ({ ...prev, deltaX }));
  }, [dragState.isDragging, dragState.startX]);

  const onTouchEnd = useCallback(() => {
    if (!dragState.isDragging) return;
    const elapsed = Date.now() - dragState.startTime;
    const absDelta = Math.abs(dragState.deltaX);

    if (absDelta > 60 && elapsed < 800) {
      if (!isFlipped) {
        // Any swipe when not flipped → flip
        setIsFlipped(true);
      } else {
        // Flipped: right = good, left = again
        if (dragState.deltaX > 0) {
          handleAnswer('good');
        } else {
          handleAnswer('again');
        }
      }
    }

    setDragState({ isDragging: false, deltaX: 0, startX: 0, startTime: 0 });
  }, [dragState, isFlipped, handleAnswer]);

  // ---------------------------------------------------------------------------
  // Card transform (drag follow)
  // ---------------------------------------------------------------------------

  const dragTranslateX = dragState.isDragging ? dragState.deltaX : 0;
  const dragRotation = dragState.isDragging ? dragState.deltaX * 0.03 : 0;
  const leftSwipeIntensity = dragState.isDragging && dragState.deltaX < 0
    ? Math.min(Math.abs(dragState.deltaX) / 150, 1)
    : 0;

  // ---------------------------------------------------------------------------
  // Render: Loading
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="learn-page">
        <div className="loading-screen">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="learn-page">
        <div className="flashcard-empty">
          <p style={{ color: 'var(--danger)' }}>Failed to load cards: {error}</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Empty state
  // ---------------------------------------------------------------------------

  if (cards.length === 0) {
    return (
      <div className="learn-page">
        <div className="flashcard-empty">
          <div className="flashcard-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
          <h2>No words to study yet</h2>
          <p>Save words from conversations to start learning.</p>
          <div className="flashcard-empty-box">
            <p>Tap words in subtitles during calls, then press <strong>+</strong> to save them to your dictionary.</p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Session complete
  // ---------------------------------------------------------------------------

  if (currentIndex >= cards.length) {
    const duration = Math.round((Date.now() - sessionStartRef.current) / 1000);
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    const accuracy = sessionStats.reviewed > 0
      ? Math.round((sessionStats.correct / sessionStats.reviewed) * 100)
      : 0;

    return (
      <div className="learn-page">
        <div className="flashcard-complete">
          <div className="flashcard-complete-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h2>Session Complete</h2>
          <div className="flashcard-complete-stats">
            <div className="flashcard-stat">
              <span className="flashcard-stat-value">{sessionStats.reviewed}</span>
              <span className="flashcard-stat-label">Cards reviewed</span>
            </div>
            <div className="flashcard-stat">
              <span className="flashcard-stat-value">{accuracy}%</span>
              <span className="flashcard-stat-label">Accuracy</span>
            </div>
            <div className="flashcard-stat">
              <span className="flashcard-stat-value">{mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}</span>
              <span className="flashcard-stat-label">Duration</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Done
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Active card
  // ---------------------------------------------------------------------------

  const card = currentCard;
  const hasExample = !!card.example_sentence;

  return (
    <div className="learn-page">
      {/* Progress */}
      <div className="flashcard-progress">
        <span>{currentIndex + 1} / {cards.length}</span>
      </div>

      {/* Card container */}
      <div className="flashcard-container">
        <div
          className={`flashcard${isExiting ? ` card-exit-${exitDirection}` : ''}${isEntering ? ' card-enter' : ''}`}
          style={{
            transform: `translateX(${dragTranslateX}px) rotate(${dragRotation}deg)`,
            borderColor: leftSwipeIntensity > 0
              ? `rgba(231, 76, 94, ${0.3 + leftSwipeIntensity * 0.7})`
              : undefined,
          }}
          onClick={() => { if (!isFlipped && !submitting) setIsFlipped(true); }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className={`flashcard-flip-wrapper${isFlipped ? ' flipped' : ''}`}>
            {/* Front */}
            <div className="flashcard-front">
              {hasExample ? (
                <>
                  <p className="flashcard-sentence">{renderCloze(card.example_sentence!)}</p>
                  <p className="flashcard-translation-hint">{card.translation}</p>
                </>
              ) : (
                <p className="flashcard-word-large">{card.word}</p>
              )}
              <p className="flashcard-hint">Tap to reveal</p>
            </div>

            {/* Back */}
            <div className="flashcard-back">
              {hasExample ? (
                <p className="flashcard-sentence">{renderTildeHighlight(card.example_sentence!, 'flashcard-highlighted')}</p>
              ) : (
                <p className="flashcard-word-large flashcard-highlighted">{card.word}</p>
              )}

              {card.image_url && (
                <img className="flashcard-image" src={card.image_url} alt={card.word} />
              )}

              <div className="flashcard-back-details">
                <p className="flashcard-back-translation">
                  <strong>{card.word}</strong> — {card.translation}
                </p>
                {card.definition && (
                  <p className="flashcard-back-definition">{card.definition}</p>
                )}
              </div>

              <button
                className="flashcard-audio-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  const text = hasExample
                    ? stripTildes(card.example_sentence!)
                    : card.word;
                  playAudio(text, card.target_language);
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Answer buttons — Incorrect / Correct */}
      <div className="flashcard-answer-buttons">
        <button
          className="flashcard-btn flashcard-btn--again"
          disabled={!isFlipped || submitting}
          onClick={() => handleAnswer('again')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span className="flashcard-btn-label">Incorrect</span>
          <span className="flashcard-btn-time">{getButtonTimeLabel(card, 'again')}</span>
        </button>
        <button
          className="flashcard-btn flashcard-btn--good"
          disabled={!isFlipped || submitting}
          onClick={() => handleAnswer('good')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="flashcard-btn-label">Correct</span>
          <span className="flashcard-btn-time">{getButtonTimeLabel(card, 'good')}</span>
        </button>
      </div>

      {/* Feedback overlay */}
      {feedback && (
        <div className={`flashcard-feedback flashcard-feedback--${feedback.answer}`}>
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  );
}
