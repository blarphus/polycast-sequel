// ---------------------------------------------------------------------------
// pages/Practice.tsx -- Practice quiz page (conjugation, grammar, translation)
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  generateQuiz,
  createQuizSession,
  submitQuizAnswer,
  completeQuizSession,
  type QuizQuestion,
  type QuizAnswerResult,
  type QuizSessionResult,
} from '../api';
import { playCorrectSound, playIncorrectSound, playCompleteSound } from '../utils/sounds';
import { TargetIcon, BoltIcon, CheckCircleIcon, CloseIcon } from '../components/icons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = 'config' | 'generating' | 'active' | 'feedback' | 'results';

interface AnswerRecord {
  questionIndex: number;
  userAnswer: string;
  result: QuizAnswerResult;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Practice() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Phase state machine
  const [phase, setPhase] = useState<Phase>(videoId ? 'generating' : 'config');
  const [error, setError] = useState('');

  // Quiz data
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);

  // Answer state
  const [userInput, setUserInput] = useState('');
  const [wordBankSelected, setWordBankSelected] = useState<string[]>([]);
  const [wordBankPool, setWordBankPool] = useState<string[]>([]);
  const [currentFeedback, setCurrentFeedback] = useState<QuizAnswerResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [answerRecords, setAnswerRecords] = useState<AnswerRecord[]>([]);

  // Results
  const [results, setResults] = useState<QuizSessionResult | null>(null);
  const sessionStartRef = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Generate quiz on mount (video mode) or after config
  // ---------------------------------------------------------------------------

  const startQuiz = useCallback(async (vid?: string) => {
    setPhase('generating');
    setError('');
    try {
      const { questions: qs } = await generateQuiz(vid);
      setQuestions(qs);

      const mode = vid ? 'video' : 'standalone';
      const { sessionId: sid } = await createQuizSession(mode, qs, vid);
      setSessionId(sid);

      // Set up first question
      setCurrentIndex(0);
      setupQuestion(qs[0]);
      setPhase('active');
    } catch (err: any) {
      console.error('Failed to generate quiz:', err);
      setError(err.message);
      setPhase('config');
    }
  }, []);

  useEffect(() => {
    if (videoId) {
      startQuiz(videoId);
    }
  }, [videoId, startQuiz]);

  // ---------------------------------------------------------------------------
  // Question setup
  // ---------------------------------------------------------------------------

  function setupQuestion(q: QuizQuestion) {
    setUserInput('');
    setWordBankSelected([]);
    setCurrentFeedback(null);
    if (q.input_mode === 'word_bank' && q.distractors.length > 0) {
      setWordBankPool(shuffleArray([...q.distractors]));
    } else {
      setWordBankPool([]);
    }
  }

  // ---------------------------------------------------------------------------
  // Submit answer
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    const q = questions[currentIndex];
    if (!q) return;

    const answer = q.input_mode === 'word_bank'
      ? wordBankSelected.join(' ')
      : userInput.trim();

    if (!answer) return;

    setSubmitting(true);
    try {
      const result = await submitQuizAnswer(sessionId, currentIndex, answer);
      setCurrentFeedback(result);
      setAnswerRecords((prev) => [...prev, { questionIndex: currentIndex, userAnswer: answer, result }]);

      if (result.isCorrect) {
        playCorrectSound();
      } else {
        playIncorrectSound();
      }

      setPhase('feedback');
    } catch (err: any) {
      console.error('Failed to submit answer:', err);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, questions, currentIndex, wordBankSelected, userInput, sessionId]);

  // ---------------------------------------------------------------------------
  // Next question / Complete
  // ---------------------------------------------------------------------------

  const handleNext = useCallback(async () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= questions.length) {
      // Complete the session
      try {
        const sessionResult = await completeQuizSession(sessionId);
        setResults(sessionResult);
        setPhase('results');
        playCompleteSound();
      } catch (err: any) {
        console.error('Failed to complete session:', err);
        setError(err.message);
      }
    } else {
      setCurrentIndex(nextIndex);
      setupQuestion(questions[nextIndex]);
      setPhase('active');
    }
  }, [currentIndex, questions, sessionId]);

  // ---------------------------------------------------------------------------
  // Word bank interaction
  // ---------------------------------------------------------------------------

  function handleWordBankTap(word: string, poolIndex: number) {
    setWordBankSelected((prev) => [...prev, word]);
    setWordBankPool((prev) => prev.filter((_, i) => i !== poolIndex));
  }

  function handleWordBankRemove(selectedIndex: number) {
    const word = wordBankSelected[selectedIndex];
    setWordBankSelected((prev) => prev.filter((_, i) => i !== selectedIndex));
    setWordBankPool((prev) => [...prev, word]);
  }

  // Focus input when entering active phase
  useEffect(() => {
    if (phase === 'active' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [phase, currentIndex]);

  // Keyboard submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && phase === 'active') {
      handleSubmit();
    } else if (e.key === 'Enter' && phase === 'feedback') {
      handleNext();
    }
  };

  // ---------------------------------------------------------------------------
  // Render: Config (standalone mode)
  // ---------------------------------------------------------------------------

  if (phase === 'config') {
    return (
      <div className="practice-page" onKeyDown={handleKeyDown}>
        <div className="practice-config">
          <div className="practice-config-icon">
            <TargetIcon size={48} strokeWidth={1.5} />
          </div>
          <h2>Practice</h2>
          <p>Choose your practice mode</p>
          {error && <p className="practice-error">{error}</p>}

          <div className="practice-mode-cards">
            <button
              className="practice-mode-card active"
              onClick={() => startQuiz()}
            >
              <div className="practice-mode-card-icon">
                <TargetIcon size={28} strokeWidth={1.5} />
              </div>
              <div className="practice-mode-card-title">Mixed Quiz</div>
              <div className="practice-mode-card-desc">
                10 questions: conjugation, grammar, translation.
              </div>
            </button>
            <button
              className="practice-mode-card"
              onClick={() => navigate('/practice/drill')}
            >
              <div className="practice-mode-card-icon">
                <BoltIcon size={28} strokeWidth={1.5} />
              </div>
              <div className="practice-mode-card-title">Conjugation Drill</div>
              <div className="practice-mode-card-desc">
                Fast-paced verb drill. Type conjugations, instant feedback.
              </div>
            </button>
          </div>

          <button className="btn btn-secondary" onClick={() => navigate(-1)}>
            Back
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Generating
  // ---------------------------------------------------------------------------

  if (phase === 'generating') {
    return (
      <div className="practice-page">
        <div className="practice-generating">
          <div className="loading-spinner" />
          <p>Generating your quiz...</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Results
  // ---------------------------------------------------------------------------

  if (phase === 'results' && results) {
    const duration = Math.round((Date.now() - sessionStartRef.current) / 1000);
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;

    return (
      <div className="practice-page">
        <div className="practice-results">
          <div className="practice-results-icon">
            <CheckCircleIcon size={56} style={{ color: '#4ade80' }} />
          </div>
          <h2>Quiz Complete</h2>
          <div className="practice-stats">
            <div className="practice-stat">
              <span className="practice-stat-value">{results.correctCount}/{results.questionCount}</span>
              <span className="practice-stat-label">Correct</span>
            </div>
            <div className="practice-stat">
              <span className="practice-stat-value">{results.percentage}%</span>
              <span className="practice-stat-label">Score</span>
            </div>
            <div className="practice-stat">
              <span className="practice-stat-value">{mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}</span>
              <span className="practice-stat-label">Time</span>
            </div>
          </div>

          {/* Per-question review */}
          <div className="practice-review-list">
            {results.answers.map((a) => (
              <div key={a.questionIndex} className={`practice-review-item ${a.isCorrect ? 'correct' : 'incorrect'}`}>
                <div className="practice-review-header">
                  <span className={`practice-review-badge ${a.isCorrect ? 'correct' : 'incorrect'}`}>
                    {a.isCorrect ? 'Correct' : 'Incorrect'}
                  </span>
                  <span className="practice-review-type">{a.questionType}</span>
                </div>
                <p className="practice-review-prompt">{a.prompt}</p>
                {!a.isCorrect && (
                  <p className="practice-review-expected">Expected: {a.expectedAnswer}</p>
                )}
                <p className="practice-review-user">Your answer: {a.userAnswer}</p>
                {a.aiFeedback && <p className="practice-review-feedback">{a.aiFeedback}</p>}
              </div>
            ))}
          </div>

          <div className="practice-results-actions">
            <button className="btn btn-primary" onClick={() => {
              setPhase(videoId ? 'generating' : 'config');
              setAnswerRecords([]);
              setResults(null);
              sessionStartRef.current = Date.now();
              if (videoId) startQuiz(videoId);
            }}>
              Try Again
            </button>
            <button className="btn btn-secondary" onClick={() => navigate(videoId ? `/watch/${videoId}` : '/')}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Active / Feedback
  // ---------------------------------------------------------------------------

  const question = questions[currentIndex];
  if (!question) return null;

  const progressPercent = ((currentIndex + (phase === 'feedback' ? 1 : 0)) / questions.length) * 100;
  const isWordBank = question.input_mode === 'word_bank';

  return (
    <div className="practice-page" onKeyDown={handleKeyDown}>
      {/* Progress bar */}
      <div className="practice-progress-bar">
        <div className="practice-progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="practice-progress-text">
        {currentIndex + 1} / {questions.length}
      </div>

      {/* Close button */}
      <button className="practice-close" onClick={() => navigate(videoId ? `/watch/${videoId}` : '/')}>
        <CloseIcon size={20} />
      </button>

      {/* Question card */}
      <div className="practice-question-area">
        <span className="practice-question-type">{question.type}</span>
        <p className="practice-prompt">{question.prompt}</p>
        {question.hint && phase === 'active' && (
          <p className="practice-hint">Hint: {question.hint}</p>
        )}

        {/* Input area */}
        {phase === 'active' && (
          <>
            {isWordBank ? (
              <div className="practice-word-bank">
                {/* Selected words (answer assembly) */}
                <div className="practice-wb-answer">
                  {wordBankSelected.length === 0 && (
                    <span className="practice-wb-placeholder">Tap words to build your answer</span>
                  )}
                  {wordBankSelected.map((word, i) => (
                    <button
                      key={`sel-${i}`}
                      className="practice-wb-tile selected"
                      onClick={() => handleWordBankRemove(i)}
                    >
                      {word}
                    </button>
                  ))}
                </div>
                {/* Available words */}
                <div className="practice-wb-pool">
                  {wordBankPool.map((word, i) => (
                    <button
                      key={`pool-${i}`}
                      className="practice-wb-tile"
                      onClick={() => handleWordBankTap(word, i)}
                    >
                      {word}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <input
                ref={inputRef}
                type="text"
                className="practice-input"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Type your answer..."
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            )}
            <button
              className="btn btn-primary practice-submit"
              onClick={handleSubmit}
              disabled={submitting || (isWordBank ? wordBankSelected.length === 0 : !userInput.trim())}
            >
              {submitting ? 'Checking...' : 'Check'}
            </button>
          </>
        )}

        {/* Feedback */}
        {phase === 'feedback' && currentFeedback && (
          <div className={`practice-feedback ${currentFeedback.isCorrect ? 'correct' : 'incorrect'}`}>
            <div className="practice-feedback-header">
              <span className={`practice-feedback-badge ${currentFeedback.isCorrect ? 'correct' : 'incorrect'}`}>
                {currentFeedback.isCorrect ? 'Correct' : 'Incorrect'}
              </span>
            </div>
            {!currentFeedback.isCorrect && (
              <p className="practice-feedback-expected">
                Correct answer: {currentFeedback.expectedAnswer}
              </p>
            )}
            {currentFeedback.aiFeedback && (
              <p className="practice-feedback-text">{currentFeedback.aiFeedback}</p>
            )}
            <button className="btn btn-primary practice-next" onClick={handleNext}>
              {currentIndex + 1 >= questions.length ? 'See Results' : 'Next'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
