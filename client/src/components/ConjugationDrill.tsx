// ---------------------------------------------------------------------------
// components/ConjugationDrill.tsx -- Conjuguemos-style conjugation drill
// ---------------------------------------------------------------------------

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ConjugationProblem } from '../api';
import { playCorrectSound, playIncorrectSound, playCompleteSound } from '../utils/sounds';
import { CloseIcon, FlameIcon, CheckCircleIcon } from './icons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  problems: ConjugationProblem[];
  onExit: () => void;
}

type FlashState = 'none' | 'correct' | 'incorrect';

interface DrillAnswer {
  problem: ConjugationProblem;
  userAnswer: string;
  correct: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConjugationDrill({ problems, onExit }: Props) {
  const navigate = useNavigate();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [correctCount, setCorrectCount] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [flashState, setFlashState] = useState<FlashState>('none');
  const [showExpected, setShowExpected] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [answers, setAnswers] = useState<DrillAnswer[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef(Date.now());

  // Focus input on mount and after each advance
  useEffect(() => {
    if (!showSummary && flashState === 'none' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [currentIndex, flashState, showSummary]);

  // ---------------------------------------------------------------------------
  // Submit answer
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(() => {
    if (flashState !== 'none') return;
    const trimmed = userInput.trim();
    if (!trimmed) return;

    const problem = problems[currentIndex];
    const isCorrect = trimmed.toLowerCase() === problem.expected.trim().toLowerCase();

    setAnswers((prev) => [...prev, { problem, userAnswer: trimmed, correct: isCorrect }]);

    if (isCorrect) {
      playCorrectSound();
      setCorrectCount((c) => c + 1);
      const newStreak = streak + 1;
      setStreak(newStreak);
      if (newStreak > bestStreak) setBestStreak(newStreak);
      setFlashState('correct');

      setTimeout(() => {
        setFlashState('none');
        setUserInput('');
        setShowExpected('');
        advance();
      }, 400);
    } else {
      playIncorrectSound();
      setIncorrectCount((c) => c + 1);
      setStreak(0);
      setShowExpected(problem.expected);
      setFlashState('incorrect');

      setTimeout(() => {
        setFlashState('none');
        setUserInput('');
        setShowExpected('');
        advance();
      }, 1200);
    }
  }, [flashState, userInput, currentIndex, problems, streak, bestStreak]);

  function advance() {
    const next = currentIndex + 1;
    if (next >= problems.length) {
      setShowSummary(true);
      playCompleteSound();
    } else {
      setCurrentIndex(next);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleClose = () => {
    setShowSummary(true);
  };

  // ---------------------------------------------------------------------------
  // Summary screen
  // ---------------------------------------------------------------------------

  if (showSummary) {
    const total = correctCount + incorrectCount;
    const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const duration = Math.round((Date.now() - startTimeRef.current) / 1000);
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    const incorrectAnswers = answers.filter((a) => !a.correct);

    return (
      <div className="drill-container">
        <div className="drill-summary">
          <div className="practice-results-icon">
            <CheckCircleIcon size={56} style={{ color: '#4ade80' }} />
          </div>
          <h2>Drill Complete</h2>
          <div className="practice-stats">
            <div className="practice-stat">
              <span className="practice-stat-value">{correctCount}/{total}</span>
              <span className="practice-stat-label">Correct</span>
            </div>
            <div className="practice-stat">
              <span className="practice-stat-value">{accuracy}%</span>
              <span className="practice-stat-label">Accuracy</span>
            </div>
            <div className="practice-stat">
              <span className="practice-stat-value">{bestStreak}</span>
              <span className="practice-stat-label">Best Streak</span>
            </div>
            <div className="practice-stat">
              <span className="practice-stat-value">{mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}</span>
              <span className="practice-stat-label">Time</span>
            </div>
          </div>

          {incorrectAnswers.length > 0 && (
            <div className="practice-review-list">
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>Incorrect Answers</h3>
              {incorrectAnswers.map((a, i) => (
                <div key={i} className="practice-review-item incorrect">
                  <div className="practice-review-header">
                    <span className="practice-review-badge incorrect">Incorrect</span>
                    <span className="practice-review-type">{a.problem.tense}</span>
                  </div>
                  <p className="practice-review-prompt">
                    {a.problem.pronoun} ___ ({a.problem.infinitive})
                  </p>
                  <p className="practice-review-expected">Expected: {a.problem.expected}</p>
                  <p className="practice-review-user">Your answer: {a.userAnswer}</p>
                </div>
              ))}
            </div>
          )}

          <div className="practice-results-actions">
            <button className="btn btn-primary" onClick={onExit}>
              New Drill
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/')}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Active drill
  // ---------------------------------------------------------------------------

  const problem = problems[currentIndex];

  const containerClass = [
    'drill-container',
    flashState === 'correct' ? 'drill-flash-correct' : '',
    flashState === 'incorrect' ? 'drill-flash-incorrect' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={containerClass}>
      {/* Score bar */}
      <div className="drill-score-bar">
        <span className="drill-score-correct">{correctCount}</span>
        <span className="drill-score-divider">/</span>
        <span className="drill-score-total">{correctCount + incorrectCount}</span>
        <span className="drill-score-streak">
          <FlameIcon size={18} strokeWidth={2} />
          {streak}
        </span>
      </div>

      {/* Close button */}
      <button className="practice-close" onClick={handleClose}>
        <CloseIcon size={20} />
      </button>

      {/* Question */}
      <div className="drill-question">
        <div className="drill-infinitive">{problem.infinitive}</div>
        <div className="drill-tense">{problem.tense_target}</div>

        <div className="drill-input-row">
          <span className="drill-pronoun">{problem.pronoun}</span>
          <input
            ref={inputRef}
            type="text"
            className={`drill-input ${flashState === 'correct' ? 'correct' : ''} ${flashState === 'incorrect' ? 'incorrect' : ''}`}
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="..."
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={flashState !== 'none'}
          />
        </div>

        {showExpected && (
          <div className="drill-expected">{problem.expected}</div>
        )}
      </div>

      {/* Progress */}
      <div className="drill-progress">
        {currentIndex + 1} / {problems.length}
      </div>
    </div>
  );
}
