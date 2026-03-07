import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useVoicePracticeSession } from '../hooks/useVoicePracticeSession';
import { ChevronLeftIcon, CheckCircleIcon, CloseIcon, MicIcon, MicOffIcon, SpeakerIcon, TargetIcon } from '../components/icons';
import { playAiSpeech } from '../utils/aiSpeech';

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
    feedbackLanguageMode,
    counts,
    startListening,
    stopListening,
    skipPrompt,
    nextPrompt,
    redoPrompt,
    canRedoCurrentPrompt,
    formatDuration,
  } = useVoicePracticeSession();

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
            <p>{summary.correctCount} correct, {summary.partialCount} partial, {summary.incorrectCount} incorrect, {summary.skippedCount} skipped.</p>
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
                <span className="voice-practice-summary-value">{summary.feedbackLanguageMode}</span>
                <span className="voice-practice-summary-label">Feedback</span>
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
          <button className="voice-practice-back" onClick={() => navigate('/practice')}>
            <ChevronLeftIcon size={16} />
            Practice
          </button>
          <div className="voice-practice-progress">
            <span>{currentIndex + 1} / {totalPrompts}</span>
            <span className={`voice-practice-conn conn-${connectionState}`}>{connectionState}</span>
          </div>
        </div>

        <div className="voice-practice-meta">
          <span className="voice-practice-badge">{currentSentence.source_type}</span>
          {currentSentence.difficulty && <span className="voice-practice-badge">{currentSentence.difficulty}</span>}
          {currentSentence.assignment_priority && <span className="voice-practice-badge voice-practice-badge--priority">assigned</span>}
          <span className="voice-practice-feedback-mode">Feedback: {feedbackLanguageMode}</span>
        </div>

        <div className="voice-practice-reminder">
          Translate into {session.targetLanguage}. If you do not know a word, say that word in your native language and do your best. You can ask the tutor to speak in either language.
        </div>

        <div className="voice-practice-card">
          <div className="voice-practice-card-label">
            <TargetIcon size={16} strokeWidth={1.8} />
            Translate into {session.targetLanguage}
          </div>
          <p className="voice-practice-prompt">{currentSentence.native_prompt}</p>

          <div className="voice-practice-transcript-block">
            <div className="voice-practice-transcript-label">What you said</div>
            <div className={`voice-practice-transcript ${currentTranscript ? 'has-text' : ''}`}>
              {currentTranscript || 'Your spoken answer will appear here.'}
            </div>
          </div>

          {isRepeatStage && (
            <div className={`voice-practice-repeat-block ${repeatComplete ? 'is-complete' : ''}`}>
              <div className="voice-practice-repeat-label">Repeat this once, then we move on</div>
              <div className="voice-practice-repeat-target">{repeatTarget}</div>
              <div className={`voice-practice-repeat-transcript ${repeatTranscript ? 'has-text' : ''}`}>
                {repeatTranscript || 'Your repetition will appear here.'}
              </div>
              {repeatComplete && (
                <div className="voice-practice-repeat-status">Repetition captured.</div>
              )}
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
                  <div className="voice-practice-feedback-label">Annotated answer</div>
                  <div className="voice-practice-feedback-text">{renderAnnotatedAnswer(currentGrade.annotatedUserAnswer)}</div>
                </div>
              )}
              <div className="voice-practice-feedback-row">
                <div className="voice-practice-feedback-label">
                  {currentGrade.result === 'correct' ? 'Nice work' : 'Correct answer'}
                </div>
                <div className="voice-practice-feedback-text voice-practice-feedback-text--with-audio">
                  <span>{currentGrade.correctedAnswer}</span>
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
        </div>

        {error && <p className="practice-error voice-practice-inline-error">{error}</p>}

        <div className="voice-practice-actions">
          {!currentGrade ? (
            <>
              <div className="voice-practice-recording-row">
                <button
                  className={`voice-practice-mic ${listening ? 'is-listening' : ''}`}
                  onClick={listening ? stopListening : startListening}
                  disabled={connectionState !== 'ready' || grading || committing}
                >
                  {listening ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
                  {listening ? 'Done speaking' : committing ? 'Sending…' : 'Start speaking'}
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
              {canRedoCurrentPrompt && !listening && !committing && (
                <button className="btn btn-secondary" onClick={redoPrompt}>
                  Redo this one
                </button>
              )}
              <button className="btn btn-secondary" onClick={skipPrompt} disabled={grading}>
                Skip
              </button>
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
          <span>{counts.correct} correct</span>
          <span>{counts.partial} partial</span>
          <span>{counts.incorrect} incorrect</span>
          <span>{counts.skipped} skipped</span>
          {grading && <span>grading…</span>}
        </div>
      </div>
    </div>
  );
}
