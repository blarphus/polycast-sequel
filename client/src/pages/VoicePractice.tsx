import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVoicePracticeSession } from '../hooks/useVoicePracticeSession';
import { useSavedWords } from '../hooks/useSavedWords';
import { proxyImageUrl } from '../api';
import { CheckCircleIcon, CloseIcon, MicIcon, MicOffIcon, SpeakerIcon, TargetIcon } from '../components/icons';
import { playAiSpeech } from '../utils/aiSpeech';
import TokenizedText, { type WordHint } from '../components/TokenizedText';
import WordPopup from '../components/WordPopup';

function renderAnnotatedAnswer(text: string) {
  const parts = text.split(/(~~.*?~~)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('~~') && part.endsWith('~~')) {
      return <span key={index} className="voice-practice-strike">{part.slice(2, -2)}</span>;
    }
    return <span key={index}>{part}</span>;
  });
}

function renderSuccessConfetti() {
  return (
    <div className="voice-practice-success-confetti" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <span key={index} className={`voice-practice-confetti-bit bit-${index + 1}`} />
      ))}
    </div>
  );
}

export default function VoicePractice() {
  const navigate = useNavigate();
  const { words, savedWordsSet, isWordSaved, isDefinitionSaved, addWord, addOptimistic } = useSavedWords();

  // Map native translations → image hints for highlighting in the native prompt
  const nativeWordHints = useMemo(() => {
    const map = new Map<string, WordHint>();
    for (const w of words) {
      if (!w.translation) continue;
      // Translation can be multi-word; split and map each word
      for (const part of w.translation.toLowerCase().split(/\s+/)) {
        const cleaned = part.replace(/[^a-zA-Z\u00C0-\u024F]/g, '');
        if (cleaned && !map.has(cleaned)) {
          map.set(cleaned, { imageUrl: proxyImageUrl(w.image_url) });
        }
      }
    }
    return map;
  }, [words]);
  const [popup, setPopup] = useState<{ word: string; sentence: string; rect: DOMRect; isNative?: boolean } | null>(null);

  function handleWordClick(e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) {
    setPopup({ word, sentence, rect: (e.target as HTMLElement).getBoundingClientRect() });
  }

  const {
    loading,
    error,
    session,
    summary,
    currentSentence,
    currentIndex,
    totalPrompts,
    currentTranscript,
    currentGrade,
    repeatTarget,
    repeatTranscript,
    repeatComplete,
    isRepeatStage,
    listening,
    grading,
    committing,
    audioPeaks,
    connectionState,
    counts,
    startListening,
    stopListening,
    submitTypedAnswer,
    skipPrompt,
    nextPrompt,
    redoPrompt,
    canRedoCurrentPrompt,
    formatDuration,
  } = useVoicePracticeSession();

  const [typingMode, setTypingMode] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState('');
  const typedInputRef = useRef<HTMLInputElement>(null);

  if (loading) {
    return (
      <div className="voice-practice-page">
        <div className="practice-generating">
          <div className="loading-spinner" />
          <p>Preparing voice translation…</p>
        </div>
      </div>
    );
  }

  if (summary) {
    return (
      <div className="voice-practice-page">
        <button className="practice-close" onClick={() => navigate('/practice')}>
          <CloseIcon size={18} />
        </button>
        <div className="voice-practice-shell">
          <div className="voice-practice-summary">
            <div className="voice-practice-summary-icon">
              <CheckCircleIcon size={52} strokeWidth={1.6} />
            </div>
            <h2>Session complete</h2>
            <div className="voice-practice-summary-grid">
              <div className="voice-practice-summary-card">
                <span className="voice-practice-summary-value">{summary.promptCount}</span>
                <span className="voice-practice-summary-label">Prompts</span>
              </div>
              <div className="voice-practice-summary-card">
                <span className="voice-practice-summary-value">{formatDuration(summary.durationSeconds)}</span>
                <span className="voice-practice-summary-label">Duration</span>
              </div>
              <div className="voice-practice-summary-card">
                <span className="voice-practice-summary-value">
                  {(summary.correctCount + summary.partialCount + summary.incorrectCount) > 0
                    ? `${Math.round((summary.correctCount / (summary.correctCount + summary.partialCount + summary.incorrectCount)) * 100)}%`
                    : '--'}
                </span>
                <span className="voice-practice-summary-label">Accuracy</span>
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => navigate('/practice')}>
              Back to Practice
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!session || !currentSentence) {
    return (
      <div className="voice-practice-page">
        <div className="practice-config">
          <h2>Voice Translation</h2>
          <p className="practice-error">{error || 'Could not start a voice practice session.'}</p>
          <button className="btn btn-secondary" onClick={() => navigate('/practice')}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-practice-page">
      <button className="practice-close" onClick={() => navigate('/practice')}>
        <CloseIcon size={18} />
      </button>

      <div className="voice-practice-shell">
        <div className="voice-practice-header">
          <div className="voice-practice-progress">
            <span>{currentIndex + 1} / {totalPrompts}</span>
            {connectionState === 'error' && (
              <span className="voice-practice-conn conn-error">{connectionState}</span>
            )}
          </div>
        </div>

        <div className="voice-practice-card">
          <div className="voice-practice-card-label">
            <TargetIcon size={16} strokeWidth={1.8} />
            Translate into {session.targetLanguage}
          </div>
          <p className="voice-practice-prompt">
            <TokenizedText
              text={currentSentence.native_prompt}
              wordHints={nativeWordHints}
              onWordClick={(e, word) => setPopup({ word, sentence: currentSentence.native_prompt, rect: (e.target as HTMLElement).getBoundingClientRect(), isNative: true })}
            />
          </p>

          {currentTranscript && !currentGrade && (
            <div className="voice-practice-transcript-block voice-practice-slide-in">
              <div className="voice-practice-transcript-label">What you said</div>
              <div className="voice-practice-transcript has-text">
                {currentTranscript}
              </div>
            </div>
          )}

          {currentGrade && (
            <div className={`voice-practice-feedback-block result-${currentGrade.result}`}>
              {currentGrade.result === 'correct' && renderSuccessConfetti()}
              <div className="voice-practice-feedback-header">
                <span className="voice-practice-feedback-result">{currentGrade.result}</span>
                <span className="voice-practice-feedback-score">{currentGrade.score}</span>
              </div>
              {currentGrade.result !== 'correct' && (
                <div className="voice-practice-feedback-row">
                  <div className="voice-practice-feedback-label">Your answer</div>
                  <div className="voice-practice-feedback-text">{renderAnnotatedAnswer(currentGrade.annotatedUserAnswer)}</div>
                </div>
              )}
              {!isRepeatStage && (
                <div className="voice-practice-feedback-row">
                  {currentGrade.result !== 'correct' && (
                    <div className="voice-practice-feedback-label">Answer</div>
                  )}
                  <div className="voice-practice-feedback-text voice-practice-feedback-text--with-audio">
                    <TokenizedText
                      text={currentGrade.correctedAnswer}
                      savedWords={savedWordsSet}
                      onWordClick={(e, word) => handleWordClick(e, word, currentGrade.correctedAnswer)}
                    />
                    {currentGrade.result !== 'correct' && (
                      <button
                        type="button"
                        className="voice-practice-audio-btn"
                        onClick={() => { void playAiSpeech(currentGrade.correctedAnswer, session.targetLanguage); }}
                        aria-label="Play pronunciation again"
                      >
                        <SpeakerIcon size={18} />
                      </button>
                    )}
                  </div>
                </div>
              )}
              {currentGrade.issueNotes.length > 0 && (
                <div className="voice-practice-feedback-row">
                  <div className="voice-practice-feedback-label">Notes</div>
                  <ul className="voice-practice-notes">
                    {currentGrade.issueNotes.map((note, index) => (
                      <li key={`${note.type}-${index}`}>{note.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {isRepeatStage && (
            <div className={`voice-practice-repeat-block ${repeatComplete ? 'is-complete' : ''}`}>
              <div className="voice-practice-repeat-label">Repeat</div>
              <div className="voice-practice-repeat-target">{repeatTarget}</div>
              {repeatTranscript && (
                <div className="voice-practice-repeat-transcript has-text">
                  {repeatTranscript}
                </div>
              )}
            </div>
          )}

          {popup && session && (
            <WordPopup
              word={popup.word}
              sentence={popup.sentence}
              nativeLang={session.nativeLanguage}
              targetLang={session.targetLanguage}
              anchorRect={popup.rect}
              onClose={() => setPopup(null)}
              isWordSaved={isWordSaved}
              isDefinitionSaved={isDefinitionSaved}
              onSaveWord={addWord}
              onOptimisticSave={addOptimistic}
              isNative={popup.isNative}
            />
          )}
        </div>

        {error && <p className="practice-error voice-practice-inline-error">{error}</p>}

        <div className="voice-practice-actions">
          {!currentGrade ? (
            <>
              {typingMode ? (
                <form
                  className="voice-practice-type-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = typedAnswer.trim();
                    if (!text) return;
                    setTypedAnswer('');
                    submitTypedAnswer(text);
                  }}
                >
                  <input
                    ref={typedInputRef}
                    className="voice-practice-type-input"
                    value={typedAnswer}
                    onChange={(e) => setTypedAnswer(e.target.value)}
                    placeholder="Type your translation..."
                    autoFocus
                    disabled={grading || committing}
                  />
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={!typedAnswer.trim() || grading || committing}
                  >
                    {committing ? 'Sending...' : 'Submit'}
                  </button>
                </form>
              ) : (
                <div className="voice-practice-recording-row">
                  <button
                    className={`voice-practice-mic ${listening ? 'is-listening' : ''}`}
                    onClick={listening ? stopListening : startListening}
                    disabled={connectionState !== 'ready' || grading || committing}
                  >
                    {listening ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
                    {listening ? 'Done speaking' : committing ? 'Sending...' : 'Start speaking'}
                  </button>
                  <div className={`voice-practice-wave ${listening ? 'is-active' : ''}`} aria-hidden="true">
                    {audioPeaks.map((peak, index) => (
                      <span
                        key={index}
                        className="voice-practice-wave-bar"
                        style={{ transform: `scaleY(${peak})` }}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div className="voice-practice-mode-toggle">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setTypingMode(!typingMode); setTypedAnswer(''); }}
                  disabled={listening || grading || committing}
                >
                  {typingMode ? 'Switch to voice' : 'Type instead'}
                </button>
                {canRedoCurrentPrompt && !listening && !committing && (
                  <button className="btn btn-secondary btn-sm" onClick={redoPrompt}>
                    Redo
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={skipPrompt} disabled={grading}>
                  Skip
                </button>
              </div>
            </>
          ) : (
            <>
              {canRedoCurrentPrompt && (
                <button className="btn btn-secondary" onClick={redoPrompt}>
                  Redo this one
                </button>
              )}
              {isRepeatStage && !repeatComplete ? (
                <div className="voice-practice-recording-row">
                  <button
                    className={`voice-practice-mic ${listening ? 'is-listening' : ''}`}
                    onClick={listening ? stopListening : startListening}
                    disabled={connectionState !== 'ready' || grading || committing}
                  >
                    {listening ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
                    {listening ? 'Done repeating' : committing ? 'Sending…' : 'Repeat sentence'}
                  </button>
                  <div className={`voice-practice-wave ${listening ? 'is-active' : ''}`} aria-hidden="true">
                    {audioPeaks.map((peak, index) => (
                      <span
                        key={index}
                        className="voice-practice-wave-bar"
                        style={{ transform: `scaleY(${peak})` }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <button className="btn btn-primary voice-practice-next" onClick={nextPrompt}>
                  {currentIndex === totalPrompts - 1 ? 'Finish session' : 'Next sentence'}
                </button>
              )}
            </>
          )}
        </div>

        <div className="voice-practice-footer">
          <div className="voice-practice-progress-bar">
            {counts.correct > 0 && (
              <div className="voice-practice-progress-fill fill-correct" style={{ flex: counts.correct }} />
            )}
            {counts.partial > 0 && (
              <div className="voice-practice-progress-fill fill-partial" style={{ flex: counts.partial }} />
            )}
            {counts.incorrect > 0 && (
              <div className="voice-practice-progress-fill fill-incorrect" style={{ flex: counts.incorrect }} />
            )}
            {counts.skipped > 0 && (
              <div className="voice-practice-progress-fill fill-skipped" style={{ flex: counts.skipped }} />
            )}
          </div>
          {grading && <span className="voice-practice-grading-label">grading...</span>}
        </div>
      </div>
    </div>
  );
}
