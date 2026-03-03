// ---------------------------------------------------------------------------
// components/PlacementTest.tsx -- CEFR vocabulary placement test
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useCallback } from 'react';
import { getPlacementWords } from '../api';

const LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;
const THRESHOLD = 15;
const WORD_COUNT = 20;

const LEVEL_LABELS: Record<string, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper Intermediate',
};

const LEVEL_DESCRIPTIONS: Record<string, string> = {
  A1: 'You can understand and use familiar everyday expressions and very basic phrases.',
  A2: 'You can understand sentences and frequently used expressions related to areas of most immediate relevance.',
  B1: 'You can deal with most situations likely to arise while travelling and describe experiences, events, and ambitions.',
  B2: 'You can interact with a degree of fluency and spontaneity that makes regular interaction with native speakers quite possible.',
};

interface Props {
  language: string;
  onComplete: (level: string) => void;
}

export default function PlacementTest({ language, onComplete }: Props) {
  const [currentLevel, setCurrentLevel] = useState<string>('A1');
  const [words, setWords] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [highestPassed, setHighestPassed] = useState<string | null>(null);

  const fetchWords = useCallback(async (level: string) => {
    setLoading(true);
    setError('');
    setSelected(new Set());
    try {
      const data = await getPlacementWords(language, level);
      setWords(data.words);
    } catch (err) {
      console.error('PlacementTest: fetch failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    fetchWords('A1');
  }, [fetchWords]);

  const toggleWord = (word: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(word)) {
        next.delete(word);
      } else {
        next.add(word);
      }
      return next;
    });
  };

  const handleCheck = () => {
    const passed = selected.size >= THRESHOLD;
    const levelIndex = LEVELS.indexOf(currentLevel as typeof LEVELS[number]);

    if (passed) {
      const newHighest = currentLevel;
      setHighestPassed(newHighest);

      // Advance to next level if possible
      if (levelIndex < LEVELS.length - 1) {
        const nextLevel = LEVELS[levelIndex + 1];
        setCurrentLevel(nextLevel);
        fetchWords(nextLevel);
        return;
      }

      // Passed the highest level (B2)
      setResult(newHighest);
    } else {
      // Didn't pass this level — result is last passed level (minimum A1)
      setResult(highestPassed || 'A1');
    }
  };

  const handleSkip = () => {
    // "I don't know any of these" — result is last passed level (minimum A1)
    setResult(highestPassed || 'A1');
  };

  const handleContinue = () => {
    if (result) onComplete(result);
  };

  // Result screen
  if (result) {
    return (
      <div className="placement-container">
        <div className="placement-result">
          <div className="placement-result-level">{result}</div>
          <div className="placement-result-label">{LEVEL_LABELS[result]}</div>
          <p className="placement-level-description">{LEVEL_DESCRIPTIONS[result]}</p>
          <button className="btn btn-primary btn-block" onClick={handleContinue}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="placement-container">
      {/* Progress dots */}
      <div className="placement-progress">
        {LEVELS.map((lv) => {
          const idx = LEVELS.indexOf(lv);
          const currentIdx = LEVELS.indexOf(currentLevel as typeof LEVELS[number]);
          let cls = 'placement-progress-step';
          if (lv === currentLevel) cls += ' active';
          else if (idx < currentIdx) cls += ' passed';
          return (
            <div key={lv} className={cls}>
              {lv}
            </div>
          );
        })}
      </div>

      <p className="placement-instruction">Tap the words you know</p>

      {error && <div className="auth-error">{error}</div>}

      {loading ? (
        <div className="placement-loading">Loading words...</div>
      ) : (
        <>
          <div className="placement-word-grid">
            {words.map((word) => (
              <button
                key={word}
                className={`placement-chip${selected.has(word) ? ' selected' : ''}`}
                onClick={() => toggleWord(word)}
                type="button"
              >
                {word}
              </button>
            ))}
          </div>

          <div className="placement-count">
            {selected.size} of {Math.min(words.length, WORD_COUNT)} selected
          </div>

          <button
            className="btn btn-primary btn-block"
            onClick={handleCheck}
            disabled={selected.size === 0}
          >
            Check
          </button>

          <button
            className="placement-skip-btn"
            onClick={handleSkip}
            type="button"
          >
            I don't know any of these
          </button>
        </>
      )}
    </div>
  );
}
