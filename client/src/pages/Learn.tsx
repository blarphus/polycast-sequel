import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.pages.learn');
// ---------------------------------------------------------------------------
// pages/Learn.tsx -- Flashcard-based SRS study page (Correct / Incorrect)
// ---------------------------------------------------------------------------

import '../styles/learn.css';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { completeLearningSession, createLearningSession, getDueWords, reviewWord, proxyImageUrl, type SavedWord, type SrsAnswer } from '../api';
import {
  applyAnswerLocally,
  getButtonTimeLabel,
  getNextDueSeconds,
  getStudyQueueBucket,
  getStudyQueueCounts,
  isNewCard,
  nextPromptStage,
} from '../utils/srs';
import { renderTildeHighlight, stripTildes, tildeWord } from '../utils/tildeMarkup';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import WordPopup from '../components/WordPopup';
import TappableFlashcardSentence from '../components/TappableFlashcardSentence';
import DictionaryEntryEditor from '../components/DictionaryEntryEditor';
import { playAiSpeech, stopAiSpeech } from '../utils/aiSpeech';
import { playFlipSound, playCorrectSound, playIncorrectSound, playCompleteSound } from '../utils/sounds';
import { BookIcon, CheckCircleIcon, SpeakerIcon, TapIcon, CloseIcon, CheckIcon, MoreVerticalIcon } from '../components/icons';
import { useI18n } from '../hooks/useI18n';
import { emitFallbackDiagnostic } from '../utils/fallbackDiagnostics';
import {
  getPromptType,
  spokenText,
  type PromptType,
} from '../utils/flashcardSpeech';

let pageFlashcardPreloader: Promise<typeof import('../utils/flashcardPreload')> | null = null;

function loadFlashcardPreloader() {
  pageFlashcardPreloader ??= import('../utils/flashcardPreload');
  return pageFlashcardPreloader;
}

// ---------------------------------------------------------------------------
// Prompt type derivation
// ---------------------------------------------------------------------------

export { getPromptType };
export type { PromptType };

export function getInstructionText(promptType: PromptType, highlightedPhrase = ''): string {
  if (promptType === 'meet-word' || promptType === 'sentence-meaning') {
    return highlightedPhrase
      ? `What does “${highlightedPhrase}” mean?`
      : 'What does the highlighted part mean?';
  }
  if (promptType === 'word-production') return 'How do you say this?';
  return 'How do you say this sentence?';
}

export function getHighlightedPrompt(card: Pick<SavedWord, 'word' | 'example_sentence'>): string {
  return tildeWord(card.example_sentence || '') || card.word;
}

function isBlueGradient(promptType: PromptType): boolean {
  return promptType === 'meet-word';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Learn() {
  const navigate = useNavigate();
  const { t } = useI18n();

  // Card queue
  const { user } = useAuth();
  const {
    savedWordsSet,
    isWordSaved,
    isDefinitionSaved,
    addWord,
    addOptimistic,
    removeWord,
    updateEntry,
  } = useSavedWords();
  const [popup, setPopup] = useState<{ word: string; sentence: string; rect: DOMRect } | null>(null);
  const [cardMenuOpen, setCardMenuOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<SavedWord | null>(null);
  const cardMenuRef = useRef<HTMLDivElement>(null);

  // Tap a target-language word on the card to add it to the dictionary. Stop
  // propagation so it never flips the card.
  const handleWordClick = (e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({ word, sentence, rect });
  };

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
  const [checkingForMore, setCheckingForMore] = useState(false);
  const [learningSessionId, setLearningSessionId] = useState<string | null>(null);
  const [sessionAward, setSessionAward] = useState<number | null>(null);
  const [sessionDiagnostic, setSessionDiagnostic] = useState('');
  const completionStartedRef = useRef(false);

  // Feedback overlay
  const [feedback, setFeedback] = useState<{ answer: SrsAnswer; text: string } | null>(null);

  // Drag / swipe
  const [dragState, setDragState] = useState({ isDragging: false, deltaX: 0, startX: 0, startTime: 0 });

  // Session stats
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, correct: 0, incorrect: 0 });
  const sessionStartRef = useRef(Date.now());

  // Audio played tracker (once per card)
  const audioPlayedRef = useRef<Set<string>>(new Set());

  // Reuse the app-level card/audio preload. If it is still running, this waits
  // on the same promises instead of starting duplicate requests.
  useEffect(() => {
    if (!user?.id) return undefined;
    loadFlashcardPreloader()
      .then(({ prepareFlashcardsForStudy }) => prepareFlashcardsForStudy(user.id))
      .then(async (data) => {
        setCards(data);
        if (data.length > 0) {
          try {
            const created = await createLearningSession('flashcards');
            setLearningSessionId(created.session.id);
          } catch (err) {
            setSessionDiagnostic(`Flashcard XP fallback used: ${err instanceof Error ? err.message : 'session tracking unavailable'}`);
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        runtimeLog.error('Failed to fetch due words:', err);
        setError(err.message);
        setLoading(false);
      });
  }, [user?.id]);

  // Continue the shared lookahead as the learner advances through the deck.
  useEffect(() => {
    if (cards.length === 0 || currentIndex >= cards.length) return;
    void loadFlashcardPreloader()
      .then(({ warmFlashcardAudio }) => warmFlashcardAudio(cards, currentIndex));
  }, [cards, currentIndex]);

  const currentCard = cards[currentIndex];

  // ---------------------------------------------------------------------------
  // Audio playback (OpenAI TTS)
  // ---------------------------------------------------------------------------

  const playCardAudio = useCallback(async (
    card: SavedWord,
    text: string,
    shouldPlay: () => boolean = () => true,
  ) => {
    try {
      const { ensureFlashcardSpeech } = await loadFlashcardPreloader();
      const preloaded = await ensureFlashcardSpeech(card, text);
      if (!shouldPlay()) return;
      await playAiSpeech(text, card.target_language || undefined, preloaded);
    } catch (error) {
      if (!shouldPlay()) return;
      runtimeLog.error(`Prepared audio playback failed for ${card.id}:`, error);
      emitFallbackDiagnostic({
        code: 'flashcard_prepared_audio_playback_fallback',
        severity: 'warning',
        title: 'Prepared flashcard audio unavailable',
        message: 'Polycast could not use the prepared pronunciation and is requesting a fresh copy now.',
        detail: error instanceof Error ? error.message : String(error),
      }, { source: 'web.flashcards', operation: 'play-preloaded-speech' });
      await playAiSpeech(text, card.target_language || undefined);
    }
  }, []);

  const promptType: PromptType = currentCard ? getPromptType(currentCard) : 'meet-word';

  // Auto-play TTS based on prompt type
  useEffect(() => {
    if (loading || !currentCard) return;
    let cancelled = false;
    const pt = getPromptType(currentCard);
    const back = isFlipped;
    const key = `${currentIndex}-${back ? 'back' : 'front'}`;
    if (audioPlayedRef.current.has(key)) return;
    const text = spokenText(currentCard, pt, back);
    if (!text) return;
    audioPlayedRef.current.add(key);
    void playCardAudio(currentCard, text, () => !cancelled);
    return () => { cancelled = true; };
  }, [isFlipped, currentIndex, currentCard, loading, playCardAudio]);

  // Play celebratory sound when session is complete
  useEffect(() => {
    if (currentIndex >= cards.length && cards.length > 0 && !loading && !checkingForMore) {
      playCompleteSound();
      if (learningSessionId && !completionStartedRef.current) {
        completionStartedRef.current = true;
        completeLearningSession(learningSessionId)
          .then((completed) => setSessionAward(completed.awardedXp))
          .catch((err) => setSessionDiagnostic(`Flashcard XP fallback used: ${err instanceof Error ? err.message : 'completion could not sync'}`));
      }
    }
  }, [currentIndex, cards.length, loading, checkingForMore, learningSessionId]);

  useEffect(() => () => stopAiSpeech(), []);

  useEffect(() => {
    if (!cardMenuOpen) return undefined;
    const closeOutside = (event: MouseEvent) => {
      if (!cardMenuRef.current?.contains(event.target as Node)) setCardMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [cardMenuOpen]);

  useEffect(() => {
    setCardMenuOpen(false);
  }, [currentIndex]);

  // ---------------------------------------------------------------------------
  // Answer handling
  // ---------------------------------------------------------------------------

  const handleAnswer = useCallback(async (answer: SrsAnswer) => {
    if (!currentCard || submitting || !isFlipped) return;
    setSubmitting(true);

    if (answer === 'again') playIncorrectSound();
    else playCorrectSound();

    const timeLabel = getButtonTimeLabel(currentCard, answer);
    const currentStage = Math.min(Math.max(currentCard.prompt_stage ?? 0, 0), 20);
    setFeedback({
      answer,
      text: `${timeLabel} · Stage ${currentStage} → ${nextPromptStage(currentCard, answer)}`,
    });

    // Update stats
    setSessionStats((prev) => ({
      reviewed: prev.reviewed + 1,
      correct: prev.correct + (answer !== 'again' ? 1 : 0),
      incorrect: prev.incorrect + (answer === 'again' ? 1 : 0),
    }));

    // Anki's default learn-ahead window is 20 minutes, so intraday steps stay
    // in this session even when no other cards remain.
    const nextDueSeconds = getNextDueSeconds(currentCard, answer);
    const requeue = nextDueSeconds <= 20 * 60;
    const localUpdate = applyAnswerLocally(currentCard, answer);
    const reviewPromise = reviewWord(currentCard.id, answer, learningSessionId || undefined).catch((err) => {
      runtimeLog.error('Review API error:', err);
      return localUpdate;
    });

    // Animate exit → next card (wrong = left, right = correct)
    setExitDirection(answer === 'again' ? 'left' : 'right');
    setIsExiting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 420));

    const updatedCard = await reviewPromise;
    void loadFlashcardPreloader()
      .then(({ invalidateFlashcardCards }) => invalidateFlashcardCards());
    setFeedback(null);
    setIsExiting(false);
    setIsFlipped(false);
    setDragState({ isDragging: false, deltaX: 0, startX: 0, startTime: 0 });

    if (requeue) {
      // The local scheduler also carries today's direct blue/red/green status.
      // Do not let an older server response erase that status mid-session.
      setCards((prev) => [...prev, {
        ...updatedCard,
        introduced_date: updatedCard.introduced_date ?? localUpdate.introduced_date,
        relearning_date: answer === 'again'
          ? localUpdate.relearning_date
          : (updatedCard.relearning_date ?? localUpdate.relearning_date),
      }]);
    }

    const nextIndex = currentIndex + 1;
    const nextCardsLength = cards.length + (requeue ? 1 : 0);
    setCurrentIndex(nextIndex);
    setIsEntering(true);
    setSubmitting(false);

    if (nextIndex >= nextCardsLength) {
      setCheckingForMore(true);
      try {
        const more = await getDueWords();
        const knownIds = new Set(cards.map((card) => card.id));
        knownIds.add(updatedCard.id);
        const unseen = more.filter((card) => !knownIds.has(card.id));
        if (unseen.length > 0) setCards((prev) => [...prev, ...unseen]);
      } catch (err) {
        runtimeLog.error('Failed to check for more cards:', err);
      } finally {
        setCheckingForMore(false);
      }
    }

    window.setTimeout(() => setIsEntering(false), 350);
  }, [cards, currentCard, currentIndex, submitting, isFlipped, learningSessionId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!currentCard) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, button, [contenteditable="true"]')) return;
      if (!isFlipped && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        playFlipSound();
        setIsFlipped(true);
        return;
      }
      if (!isFlipped || submitting) return;
      if (event.key === '1') {
        event.preventDefault();
        void handleAnswer('again');
      } else if (event.key === '2') {
        event.preventDefault();
        void handleAnswer('good');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentCard, handleAnswer, isFlipped, submitting]);

  // ---------------------------------------------------------------------------
  // Touch / swipe gestures
  // ---------------------------------------------------------------------------

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isFlipped || submitting || isExiting) return;
    setDragState({
      isDragging: true,
      deltaX: 0,
      startX: e.touches[0].clientX,
      startTime: Date.now(),
    });
  }, [isFlipped, submitting, isExiting]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragState.isDragging || !isFlipped) return;
    const deltaX = e.touches[0].clientX - dragState.startX;
    setDragState((prev) => ({ ...prev, deltaX }));
  }, [dragState.isDragging, dragState.startX, isFlipped]);

  const onTouchEnd = useCallback(() => {
    if (!dragState.isDragging) return;
    const elapsed = Date.now() - dragState.startTime;
    const absDelta = Math.abs(dragState.deltaX);

    if (isFlipped && absDelta > 60 && elapsed < 800) {
      // Flipped: right = good, left = again
      if (dragState.deltaX > 0) {
        handleAnswer('good');
      } else {
        handleAnswer('again');
      }
    }

    setDragState({ isDragging: false, deltaX: 0, startX: 0, startTime: 0 });
  }, [dragState, isFlipped, handleAnswer]);

  // ---------------------------------------------------------------------------
  // Card transform (drag follow)
  // ---------------------------------------------------------------------------

  const dragTranslateX = dragState.isDragging ? dragState.deltaX : 0;
  const dragRotation = dragState.isDragging ? dragState.deltaX * 0.03 : 0;
  const swipeIntensity = dragState.isDragging
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
          <p style={{ color: 'var(--danger)' }}>{t('learn.loadFailed', { error })}</p>
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
            <BookIcon size={48} strokeWidth={1.5} />
          </div>
          <h2>{t('learn.emptyTitle')}</h2>
          <p>{t('learn.emptyBody')}</p>
          <div className="flashcard-empty-box">
            <p>{t('learn.emptyHint')}</p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Session complete
  // ---------------------------------------------------------------------------

  if (currentIndex >= cards.length) {
    if (checkingForMore) {
      return (
        <div className="learn-page">
          <div className="flashcard-empty">
            <div className="loading-spinner" />
            <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>{t('learn.checking')}</p>
          </div>
        </div>
      );
    }

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
            <CheckCircleIcon size={56} style={{ color: '#4ade80' }} />
          </div>
          <h2>{t('learn.complete')}</h2>
          {sessionDiagnostic && <div className="flashcard-session-diagnostic" role="status">{sessionDiagnostic}</div>}
          <div className="flashcard-complete-stats">
            <div className="flashcard-stat">
              <span className="flashcard-stat-value">{sessionStats.reviewed}</span>
              <span className="flashcard-stat-label">{t('learn.reviewed')}</span>
            </div>
            <div className="flashcard-stat">
              <span className="flashcard-stat-value">{accuracy}%</span>
              <span className="flashcard-stat-label">{t('learn.accuracy')}</span>
            </div>
            <div className="flashcard-stat">
              <span className="flashcard-stat-value">{mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}</span>
              <span className="flashcard-stat-label">{t('learn.duration')}</span>
            </div>
          </div>
          <p className="flashcard-session-xp">{sessionAward === null ? t('learn.savingSession') : sessionAward ? `+${sessionAward} XP` : t('learn.sessionCap')}</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            {t('learn.done')}
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
  const cardIsNew = isNewCard(card);
  const useBlue = isBlueGradient(promptType);
  const counts = getStudyQueueCounts(cards.slice(currentIndex));
  const currentBucket = getStudyQueueBucket(card);
  const displayStage = Math.min(Math.max(card.prompt_stage ?? 0, 0), 20);
  const highlightedPhrase = getHighlightedPrompt(card);
  const instructionText = promptType === 'meet-word' || promptType === 'sentence-meaning'
    ? t('learn.phraseMeaning', { phrase: highlightedPhrase })
    : promptType === 'word-production'
      ? t('learn.wordProduction')
      : t('learn.sentenceProduction');
  const revealCard = () => {
    if (isFlipped || submitting) return;
    playFlipSound();
    setIsFlipped(true);
  };

  return (
    <div className={`learn-page learn-review-page${useBlue ? ' learn-page--recognition' : ''}`}>
      <header className="learn-review-header">
        <div className="flashcard-progress" aria-label={t('learn.queueCounts')}>
          <span className={`srs-count srs-count--new${currentBucket === 'new' ? ' is-current' : ''}`}>{counts.new}</span>
          <span className="srs-count-sep">+</span>
          <span className={`srs-count srs-count--learning${currentBucket === 'learning' ? ' is-current' : ''}`}>{counts.learning}</span>
          <span className="srs-count-sep">+</span>
          <span className={`srs-count srs-count--review${currentBucket === 'review' ? ' is-current' : ''}`}>{counts.review}</span>
        </div>
        <div className="learn-review-session-progress" aria-hidden="true">
          <span>{currentIndex + 1}</span>
          <div><i style={{ width: `${Math.max(6, ((currentIndex + 1) / Math.max(cards.length, 1)) * 100)}%` }} /></div>
          <span>{cards.length}</span>
        </div>
        <div className="learn-review-header-actions">
          <button className="learn-test-stages-btn" onClick={() => navigate('/learn/preview')}>
            {t('learn.testStages')}
          </button>
          <div className="flashcard-card-menu-anchor" ref={cardMenuRef}>
            <button
              type="button"
              className="flashcard-card-menu-button"
              aria-label="Card menu"
              aria-haspopup="menu"
              aria-expanded={cardMenuOpen}
              onClick={() => setCardMenuOpen((open) => !open)}
            >
              <MoreVerticalIcon size={20} />
            </button>
            {cardMenuOpen && (
              <div className="flashcard-card-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setEditingCard(card);
                    setCardMenuOpen(false);
                  }}
                >
                  Edit dictionary entry
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div
        className={`learn-review-workspace${isFlipped ? ' is-revealed' : ''}${isExiting ? ` card-exit-${exitDirection}` : ''}${isEntering ? ' card-enter' : ''}`}
        style={{
          '--card-drag-x': `${dragTranslateX}px`,
          '--card-drag-rotate': `${dragRotation}deg`,
          '--swipe-color': dragState.isDragging
            ? dragState.deltaX < 0
              ? `rgba(231, 76, 94, ${0.25 + swipeIntensity * 0.75})`
              : `rgba(34, 165, 94, ${0.25 + swipeIntensity * 0.75})`
            : 'transparent',
        } as React.CSSProperties}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <section className="learn-review-study-panel">
          <div className="learn-review-question">
            <span className="learn-review-question-icon" aria-hidden="true">?</span>
            <h1>{instructionText}</h1>
            <span className="learn-review-stage">
              {t('learn.stage', { stage: displayStage })}{cardIsNew ? ` · ${t('learn.new')}` : ''}
            </span>
          </div>

          <div
            className="learn-review-prompt"
            role="button"
            tabIndex={0}
            onClick={revealCard}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                revealCard();
              }
            }}
            aria-label={isFlipped ? instructionText : `${instructionText} ${t('learn.tapReveal')}`}
          >
            <div className="learn-review-prompt-copy">
              {promptType === 'meet-word' && (
                hasExample
                  ? <TappableFlashcardSentence text={card.example_sentence!} savedWords={savedWordsSet} onWordClick={handleWordClick} />
                  : <p className="flashcard-word-large flashcard-highlighted">{card.word}</p>
              )}
              {promptType === 'sentence-meaning' && (
                <TappableFlashcardSentence text={card.example_sentence!} savedWords={savedWordsSet} onWordClick={handleWordClick} />
              )}
              {promptType === 'word-production' && (
                <>
                  <p className="flashcard-native-hint">{card.translation}</p>
                  {card.definition && <p className="flashcard-native-subhint">{card.definition}</p>}
                </>
              )}
              {promptType === 'sentence-production' && (
                <p className="flashcard-sentence">{renderTildeHighlight(card.sentence_translation!, 'flashcard-highlighted')}</p>
              )}
            </div>
            {card.image_url && (
              <img
                key={`${card.id}:${card.image_url}`}
                className="flashcard-image learn-review-image"
                src={proxyImageUrl(card.image_url)!}
                alt={card.word}
                loading="lazy"
                onLoad={(event) => { event.currentTarget.classList.add('is-loaded'); }}
                onError={(event) => { event.currentTarget.style.display = 'none'; }}
              />
            )}
            {!isFlipped && (
              <span className="learn-review-reveal-hint">
                <TapIcon size={15} />
                {t('learn.tapReveal')}
              </span>
            )}
          </div>
        </section>

        <aside className="learn-review-answer-panel" aria-live="polite">
          <div className={`learn-review-answer${isFlipped ? ' is-visible' : ''}`}>
            {isFlipped ? (
              <>
                {spokenText(card, promptType, true) && (
                  <button
                    className="flashcard-audio-btn"
                    aria-label={t('learn.playAnswer')}
                    onClick={(event) => {
                      event.stopPropagation();
                      const text = spokenText(card, promptType, true)!;
                      void playCardAudio(card, text);
                    }}
                  >
                    <SpeakerIcon size={20} />
                  </button>
                )}
                <p className="learn-review-answer-word">
                  {promptType === 'meet-word' ? card.translation : card.word}
                </p>
                <span className="learn-review-answer-divider" />
                <p className="learn-review-answer-translation">
                  {promptType === 'meet-word' ? (card.definition || card.word) : card.translation}
                </p>
                {promptType === 'sentence-meaning' && card.sentence_translation && (
                  <p className="learn-review-answer-context">{stripTildes(card.sentence_translation)}</p>
                )}
                {(promptType === 'word-production' || promptType === 'sentence-production') && hasExample && (
                  <div className="learn-review-answer-context">
                    <TappableFlashcardSentence text={card.example_sentence!} savedWords={savedWordsSet} onWordClick={handleWordClick} />
                  </div>
                )}
              </>
            ) : (
              <button type="button" className="learn-review-reveal-button" onClick={revealCard}>
                <TapIcon size={18} />
                {t('learn.tapReveal')}
                <kbd>{t('learn.revealKey')}</kbd>
              </button>
            )}
          </div>

          <div className="flashcard-answer-buttons">
            <button
              className="flashcard-btn flashcard-btn--again"
              disabled={!isFlipped || submitting}
              onClick={() => handleAnswer('again')}
            >
              <CloseIcon size={22} strokeWidth={2.5} />
              <span>
                <strong className="flashcard-btn-label">{t('learn.incorrect')}</strong>
                <small>{getButtonTimeLabel(card, 'again')} · {t('learn.stage', { stage: nextPromptStage(card, 'again') })}</small>
              </span>
            </button>
            <button
              className="flashcard-btn flashcard-btn--good"
              disabled={!isFlipped || submitting}
              onClick={() => handleAnswer('good')}
            >
              <CheckIcon size={22} strokeWidth={2.5} />
              <span>
                <strong className="flashcard-btn-label">{t('learn.correct')}</strong>
                <small>{getButtonTimeLabel(card, 'good')} · {t('learn.stage', { stage: nextPromptStage(card, 'good') })}</small>
              </span>
            </button>
          </div>

          <div className="learn-review-shortcuts" aria-hidden="true">
            <span><kbd>1</kbd>{t('learn.incorrect')}</span>
            <span><kbd>2</kbd>{t('learn.correct')}</span>
          </div>
        </aside>
      </div>

      {/* Feedback overlay */}
      {feedback && (
        <div className={`flashcard-feedback flashcard-feedback--${feedback.answer}`}>
          <span>{feedback.text}</span>
        </div>
      )}

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
          onRemoveWord={removeWord}
          onOptimisticSave={addOptimistic}
        />
      )}

      {editingCard && (
        <DictionaryEntryEditor
          key={editingCard.id}
          entry={editingCard}
          onSave={async (data) => {
            const updated = await updateEntry(editingCard.id, data);
            setCards((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
            void loadFlashcardPreloader().then((preloader) => {
              preloader.invalidateFlashcardCards();
              preloader.invalidateFlashcardSpeech(editingCard.id);
            });
          }}
          onClose={() => setEditingCard(null)}
        />
      )}
    </div>
  );
}
