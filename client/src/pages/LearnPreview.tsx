import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.pages.learnpreview');
// ---------------------------------------------------------------------------
// pages/LearnPreview.tsx -- Stage preview/simulator for flashcard prompt types
// ---------------------------------------------------------------------------

import '../styles/learn.css';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDueWords, getSavedWords, proxyImageUrl, type SavedWord } from '../api';
import { getButtonTimeLabel, nextPromptStage } from '../utils/srs';
import { renderTildeHighlight, stripTildes } from '../utils/tildeMarkup';
import { playAiSpeech } from '../utils/aiSpeech';
import { playFlipSound } from '../utils/sounds';
import { getInstructionText, getPromptType, type PromptType } from './Learn';
import { SpeakerIcon, TapIcon, CloseIcon, CheckIcon, ChevronLeftIcon } from '../components/icons';

const STAGE_LABELS: Record<number, string> = {
  0: 'Stage 0: Meet the word',
  1: 'Stage 1: Translate the sentence',
  2: 'Stage 2: Produce the word',
  3: 'Stage 3: Produce the sentence',
};

function isBlueGradient(promptType: PromptType): boolean {
  return promptType === 'meet-word';
}

export default function LearnPreview() {
  const navigate = useNavigate();
  const [card, setCard] = useState<SavedWord | null>(null);
  const [loading, setLoading] = useState(true);
  const [promptStage, setPromptStage] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  useEffect(() => {
    // Try due words first, fall back to all saved words
    getDueWords()
      .then((due) => {
        if (due.length > 0) {
          setCard(due[0]);
          setPromptStage(Math.min(due[0].prompt_stage ?? 0, 3));
        } else {
          return getSavedWords().then((all) => {
            if (all.length > 0) {
              setCard(all[0]);
              setPromptStage(Math.min(all[0].prompt_stage ?? 0, 3));
            }
          });
        }
      })
      .catch((err) => runtimeLog.error('Failed to load preview card:', err))
      .finally(() => setLoading(false));
  }, []);

  const playAudio = useCallback((text: string, lang?: string | null) => {
    void playAiSpeech(text, lang || undefined);
  }, []);

  // Build a virtual card with overridden prompt_stage
  const virtualCard: SavedWord | null = card ? { ...card, prompt_stage: promptStage } : null;
  const promptType: PromptType = virtualCard ? getPromptType(virtualCard) : 'meet-word';
  const useBlue = isBlueGradient(promptType);

  const handleAnswer = useCallback((direction: 'again' | 'good') => {
    setPromptStage((prev) => {
      if (direction === 'again') return Math.max(prev - 1, 0);
      return Math.min(prev + 1, 3);
    });
    setIsFlipped(false);
  }, []);

  if (loading) {
    return (
      <div className="learn-page">
        <div className="loading-screen">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="learn-page">
        <div className="flashcard-empty">
          <p>No saved words to preview.</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>Back</button>
        </div>
      </div>
    );
  }

  const hasExample = !!card.example_sentence;
  const backAudioText = promptType === 'word-production'
    ? (hasExample ? `${card.word}. ${stripTildes(card.example_sentence!)}` : card.word)
    : promptType === 'sentence-production'
      ? stripTildes(card.example_sentence!)
      : null;

  return (
    <div className={`learn-page${useBlue ? ' learn-page--recognition' : ''}`}>
      {/* Back button */}
      <button className="learn-preview-back" onClick={() => navigate(-1)}>
        <ChevronLeftIcon size={20} />
      </button>

      {/* Stage label */}
      <div className="learn-preview-stage">{STAGE_LABELS[promptStage]}</div>

      {/* Instruction */}
      <p className="flashcard-instruction">
        {getInstructionText(promptType)}
      </p>

      {/* Card */}
      <div className="flashcard-container">
        <div
          className="flashcard"
          onClick={() => { if (!isFlipped) { playFlipSound(); setIsFlipped(true); } }}
        >
          <div className={`flashcard-flip-wrapper${isFlipped ? ' flipped' : ''}`}>
            {/* Front */}
            <div className={`flashcard-front${useBlue ? ' flashcard-front--recognition' : ''}`}>

              {promptType === 'meet-word' && (
                <>
                  {hasExample
                    ? <p className="flashcard-sentence">{renderTildeHighlight(card.example_sentence!, 'flashcard-highlighted')}</p>
                    : <p className="flashcard-word-large flashcard-highlighted">{card.word}</p>}
                  {card.image_url && (
                    <img className="flashcard-image" src={proxyImageUrl(card.image_url)!} alt={card.word} loading="lazy" />
                  )}
                </>
              )}

              {promptType === 'sentence-meaning' && (
                <p className="flashcard-sentence">{renderTildeHighlight(card.example_sentence!, 'flashcard-highlighted')}</p>
              )}

              {promptType === 'word-production' && (
                <>
                  <p className="flashcard-native-hint">{card.translation}</p>
                  {card.definition && <p className="flashcard-native-subhint">{card.definition}</p>}
                  {card.image_url && (
                    <img className="flashcard-image" src={proxyImageUrl(card.image_url)!} alt={card.word} loading="lazy" />
                  )}
                </>
              )}

              {promptType === 'sentence-production' && (
                <>
                  <p className="flashcard-sentence">{renderTildeHighlight(card.sentence_translation!, 'flashcard-highlighted')}</p>
                  {card.image_url && (
                    <img className="flashcard-image" src={proxyImageUrl(card.image_url)!} alt={card.word} loading="lazy" />
                  )}
                </>
              )}

              <p className="flashcard-hint">
                <TapIcon size={14} />
                Tap to reveal
              </p>
            </div>

            {/* Back */}
            <div className={`flashcard-back${useBlue ? ' flashcard-back--recognition' : ''}`}>

              {promptType === 'meet-word' && (
                <>
                  <p className="flashcard-recognition-translation">{card.translation}</p>
                  {card.image_url && (
                    <img className="flashcard-image" src={proxyImageUrl(card.image_url)!} alt={card.word} loading="lazy" />
                  )}
                  {card.definition && (
                    <p className="flashcard-back-definition">{card.definition}</p>
                  )}
                  {card.sentence_translation && (
                    <p className="flashcard-sentence-translation">{stripTildes(card.sentence_translation)}</p>
                  )}
                </>
              )}

              {promptType === 'sentence-meaning' && (
                <>
                  <p className="flashcard-sentence">{renderTildeHighlight(card.sentence_translation!, 'flashcard-highlighted')}</p>
                  {card.image_url && (
                    <img className="flashcard-image" src={proxyImageUrl(card.image_url)!} alt={card.word} loading="lazy" />
                  )}
                  <p className="flashcard-back-translation"><strong>{card.word}</strong> -- {card.translation}</p>
                </>
              )}

              {promptType === 'word-production' && (
                <>
                  <p className="flashcard-word-large flashcard-highlighted">{card.word}</p>
                  {card.image_url && (
                    <img className="flashcard-image" src={proxyImageUrl(card.image_url)!} alt={card.word} loading="lazy" />
                  )}
                  {card.definition && <p className="flashcard-back-definition">{card.definition}</p>}
                  {hasExample && <p className="flashcard-sentence">{renderTildeHighlight(card.example_sentence!, 'flashcard-highlighted')}</p>}
                </>
              )}

              {promptType === 'sentence-production' && (
                <>
                  <p className="flashcard-sentence">{renderTildeHighlight(card.example_sentence!, 'flashcard-highlighted')}</p>
                  {card.image_url && (
                    <img className="flashcard-image" src={proxyImageUrl(card.image_url)!} alt={card.word} loading="lazy" />
                  )}
                  <p className="flashcard-back-translation"><strong>{card.word}</strong> -- {card.translation}</p>
                </>
              )}

              {backAudioText && (
                <button
                  className="flashcard-audio-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    playAudio(backAudioText, card.target_language);
                  }}
                >
                  <SpeakerIcon size={20} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Answer buttons */}
      <div className="flashcard-answer-buttons">
        <button
          className="flashcard-btn flashcard-btn--again"
          disabled={!isFlipped}
          onClick={() => handleAnswer('again')}
        >
          <CloseIcon size={18} strokeWidth={2.5} />
          <span className="flashcard-btn-label">Incorrect</span>
          <span className="flashcard-btn-time">{getButtonTimeLabel(card, 'again')}</span>
          <span className="flashcard-btn-stage">Stage {nextPromptStage(virtualCard!, 'again')}</span>
        </button>
        <button
          className="flashcard-btn flashcard-btn--good"
          disabled={!isFlipped}
          onClick={() => handleAnswer('good')}
        >
          <CheckIcon size={18} strokeWidth={2.5} />
          <span className="flashcard-btn-label">Correct</span>
          <span className="flashcard-btn-time">{getButtonTimeLabel(card, 'good')}</span>
          <span className="flashcard-btn-stage">Stage {nextPromptStage(virtualCard!, 'good')}</span>
        </button>
      </div>
    </div>
  );
}
