import '../styles/practice.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  answerVocabularyExercise,
  completeLearningSession,
  createLearningSession,
  proxyImageUrl,
  type Diagnostic,
  type ExerciseResponse,
  type LearningSession,
  type VocabularyExercise,
} from '../api';
import { CheckCircleIcon, CloseIcon, SpeakerIcon } from '../components/icons';
import { playAiSpeech } from '../utils/aiSpeech';
import { playCompleteSound, playCorrectSound, playIncorrectSound } from '../utils/sounds';

type Feedback = { correct: boolean; correctAnswer: string; next: VocabularyExercise | null };

export default function Practice() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<LearningSession | null>(null);
  const [exercise, setExercise] = useState<VocabularyExercise | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [selectedOption, setSelectedOption] = useState('');
  const [typedAnswer, setTypedAnswer] = useState('');
  const [selectedLeft, setSelectedLeft] = useState('');
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ awardedXp: number; correct: number; total: number } | null>(null);

  const resetAnswer = useCallback(() => {
    setSelectedOption('');
    setTypedAnswer('');
    setSelectedLeft('');
    setPairs({});
    setFeedback(null);
  }, []);

  const start = useCallback(async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const created = await createLearningSession('vocabulary', videoId);
      setSession(created.session);
      setExercise(created.exercise);
      setDiagnostics(created.diagnostics || []);
      resetAnswer();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Practice could not start');
    } finally {
      setLoading(false);
    }
  }, [resetAnswer, videoId]);

  useEffect(() => { void start(); }, [start]);

  useEffect(() => {
    if (!exercise?.prompt.audioText) return;
    void playAiSpeech(exercise.prompt.audioText, exercise.prompt.language || undefined);
  }, [exercise?.id]);

  const response = useMemo<ExerciseResponse | null>(() => {
    if (!exercise) return null;
    if (exercise.kind === 'pair_match') {
      const mapped = Object.entries(pairs).map(([leftId, rightId]) => ({ leftId, rightId }));
      return mapped.length === (exercise.prompt.left?.length || 0) ? { pairs: mapped } : null;
    }
    if (exercise.prompt.options) return selectedOption ? { optionId: selectedOption } : null;
    return typedAnswer.trim() ? { text: typedAnswer.trim() } : null;
  }, [exercise, pairs, selectedOption, typedAnswer]);

  async function submit() {
    if (!session || !exercise || !response || submitting || feedback) return;
    setSubmitting(true);
    setError('');
    try {
      const answered = await answerVocabularyExercise(session.id, exercise.id, response);
      setSession(answered.session);
      setFeedback({ correct: answered.correct, correctAnswer: answered.correctAnswer, next: answered.nextExercise });
      if (answered.correct) playCorrectSound(); else playIncorrectSound();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Answer could not be saved');
    } finally {
      setSubmitting(false);
    }
  }

  async function next() {
    if (!session || !feedback) return;
    if (feedback.next) {
      setExercise(feedback.next);
      resetAnswer();
      return;
    }
    setSubmitting(true);
    try {
      const completed = await completeLearningSession(session.id);
      setResult({ awardedXp: completed.awardedXp, correct: session.correct_count, total: session.total_items });
      playCompleteSound();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Session could not be completed');
    } finally {
      setSubmitting(false);
    }
  }

  function pairLeft(leftId: string) {
    if (feedback || Object.prototype.hasOwnProperty.call(pairs, leftId)) return;
    setSelectedLeft(leftId);
  }

  function pairRight(rightId: string) {
    if (!selectedLeft || feedback || Object.values(pairs).includes(rightId)) return;
    setPairs((current) => ({ ...current, [selectedLeft]: rightId }));
    setSelectedLeft('');
  }

  if (loading) {
    return <div className="practice-page"><div className="loading-spinner" /><p className="practice-status">Preparing practice...</p></div>;
  }

  if (result) {
    const percent = result.total ? Math.round((result.correct / result.total) * 100) : 0;
    return (
      <div className="practice-page">
        <div className="practice-complete">
          <CheckCircleIcon size={52} />
          <h1>Practice complete</h1>
          <div className="practice-complete-stats">
            <span><strong>{result.correct}/{result.total}</strong> correct</span>
            <span><strong>{percent}%</strong> accuracy</span>
            <span><strong>{result.awardedXp ? `+${result.awardedXp}` : 'Capped'}</strong> XP</span>
          </div>
          <button className="btn btn-primary" onClick={() => void start()}>Practice again</button>
          <button className="btn btn-secondary" onClick={() => navigate('/learn')}>Flashcards</button>
        </div>
      </div>
    );
  }

  if (!exercise || !session) {
    return (
      <div className="practice-page">
        <div className="practice-empty">
          <h1>Practice</h1>
          <p>{error || 'No exercise is available.'}</p>
          <button className="btn btn-primary" onClick={() => navigate('/dictionary')}>Open dictionary</button>
        </div>
      </div>
    );
  }

  const progress = ((exercise.position + (feedback ? 1 : 0)) / exercise.total) * 100;
  const usedRightIds = new Set(Object.values(pairs));

  return (
    <div className="practice-page">
      <header className="practice-session-header">
        <button className="practice-close" onClick={() => navigate(videoId ? `/watch/${videoId}` : '/learn')} aria-label="Close practice">
          <CloseIcon size={20} />
        </button>
        <div className="practice-progress" aria-label={`${exercise.position + 1} of ${exercise.total}`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <strong>{exercise.position + 1} / {exercise.total}</strong>
      </header>

      {diagnostics.map((diagnostic) => (
        <div className="practice-diagnostic" role="status" key={diagnostic.code}>
          <strong>{diagnostic.title}</strong><span>{diagnostic.message}</span>
          {diagnostic.detail && <small>{diagnostic.detail}</small>}
          <small>{diagnostic.code} · {diagnostic.source}/{diagnostic.operation} · ref {diagnostic.correlationId}</small>
        </div>
      ))}
      {error && <div className="practice-error" role="alert">{error}</div>}

      <main className="practice-exercise">
        <h1>{exercise.prompt.instruction}</h1>
        {exercise.retryOf && <p className="practice-retry-label">Try this word again</p>}

        {exercise.prompt.audioText && (
          <button className="practice-audio" onClick={() => void playAiSpeech(exercise.prompt.audioText!, exercise.prompt.language || undefined)} aria-label="Play word">
            <SpeakerIcon size={30} />
          </button>
        )}
        {exercise.prompt.word && <div className="practice-term">{exercise.prompt.word}</div>}
        {exercise.prompt.meaning && !exercise.prompt.sentence && <div className="practice-meaning">{exercise.prompt.meaning}</div>}
        {exercise.prompt.sentence && (exercise.prompt.meaning || exercise.prompt.imageUrl) && (
          <div className="practice-context-clue">
            {exercise.prompt.imageUrl && (
              <img
                src={proxyImageUrl(exercise.prompt.imageUrl)!}
                alt=""
                className="practice-context-image"
                onError={(event) => { event.currentTarget.style.display = 'none'; }}
              />
            )}
            {exercise.prompt.meaning && <p><span>Meaning</span>{exercise.prompt.meaning}</p>}
          </div>
        )}
        {exercise.prompt.sentence && <div className="practice-sentence">{exercise.prompt.sentence}</div>}

        {exercise.prompt.options && (
          <div className="practice-options">
            {exercise.prompt.options.map((option) => (
              <button
                key={option.id}
                className={selectedOption === option.id ? 'selected' : ''}
                disabled={!!feedback}
                onClick={() => setSelectedOption(option.id)}
              >
                {option.text}
              </button>
            ))}
          </div>
        )}

        {exercise.kind === 'pair_match' && (
          <div className="practice-match">
            <div>
              {exercise.prompt.left?.map((item) => (
                <button key={item.id} className={`${selectedLeft === item.id ? 'selected' : ''}${Object.prototype.hasOwnProperty.call(pairs, item.id) ? ' matched' : ''}`} onClick={() => pairLeft(item.id)}>{item.text}</button>
              ))}
            </div>
            <div>
              {exercise.prompt.right?.map((item) => (
                <button key={item.id} className={usedRightIds.has(item.id) ? 'matched' : ''} onClick={() => pairRight(item.id)}>{item.text}</button>
              ))}
            </div>
          </div>
        )}

        {!exercise.prompt.options && exercise.kind !== 'pair_match' && (
          <input
            className="practice-type-input"
            value={typedAnswer}
            disabled={!!feedback}
            onChange={(event) => setTypedAnswer(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </main>

      <footer className={`practice-action-bar${feedback ? feedback.correct ? ' correct' : ' incorrect' : ''}`}>
        {feedback ? (
          <div className="practice-feedback-copy" aria-live="polite">
            <strong>{feedback.correct ? 'Correct' : 'Not quite'}</strong>
            {!feedback.correct && <span>Answer: {feedback.correctAnswer}</span>}
          </div>
        ) : <span />}
        <button className="btn btn-primary" disabled={feedback ? submitting : !response || submitting} onClick={() => void (feedback ? next() : submit())}>
          {submitting ? 'Saving...' : feedback ? (feedback.next ? 'Next' : 'Finish') : 'Check'}
        </button>
      </footer>
    </div>
  );
}
