// ---------------------------------------------------------------------------
// pages/LearnPreview.tsx -- Stage preview/simulator for flashcard prompt types
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDueWords, getSavedWords, proxyImageUrl, type SavedWord } from '../api';
import { getButtonTimeLabel } from '../utils/srs';
import { renderTildeHighlight, renderCloze, stripTildes } from '../utils/tildeMarkup';
import { playAiSpeech } from '../utils/aiSpeech';
import { playFlipSound } from '../utils/sounds';
import { getPromptType, type PromptType } from './Learn';
import { SpeakerIcon, TapIcon, CloseIcon, CheckIcon, ChevronLeftIcon } from '../components/icons';

const STAGE_LABELS: Record<number, string> = {
  0: 'Stage 0: Recognition',
  1: 'Stage 1: Recall',
  2: 'Stage 2: Guided Cloze',
  3: 'Stage 3: Context Comprehension',
  4: 'Stage 4: Target-only Cloze',
};

function getInstructionText(promptType: PromptType): string {
  if (promptType === 'recognition') return 'Do you know this word?';
  if (promptType === 'recall') return 'How do you say this?';
  return 'Fill in the blank';
}

function isBlueGradient(promptType: PromptType): boolean {
  return promptType === 'recognition' || promptType === 'recall';
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
          setPromptStage(due[0].prompt_stage ?? 0);
        } else {
          return getSavedWords().then((all) => {
            if (all.length > 0) {
              setCard(all[0]);
              setPromptStage(all[0].prompt_stage ?? 0);
            }
          });
        }
      })
      .catch((err) => console.error('Failed to load preview card:', err))
      .finally(() => setLoading(false));
  }, []);

  const playAudio = useCallback((text: string, lang?: string | null) => {
    void playAiSpeech(text, lang || undefined);
  }, []);

  // Build a virtual card with overridden prompt_stage
  const virtualCard: SavedWord | null = card ? { ...card, prompt_stage: promptStage } : null;
  const promptType: PromptType = virtualCard ? getPromptType(virtualCard) : 'recognition';
  const useBlue = isBlueGradient(promptType);

  const handleAnswer = useCallback((direction: 'again' | 'good') => {
    setPromptStage((prev) => {
      if (direction === 'again') return Math.max(prev - 1, 0);
      return Math.min(prev + 1, 4);
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

              {promptType === 'recognition' && (
                <>
                  {hasExample ? (
                    <p className="flashcard-sentence">{renderTildeHighlight(card.example_sentence!, 'flashcard-highlighted')}</p>
                  ) : (
                    <p className="flashcard-word-large flashcard-highlighted">{card.word}</p>
                  )}
                  {card.image_url && (
                    <img className="flashcard-image" src={proxyImageUrl(card.image_url)!} alt={card.word} loading="lazy" />
                  )}
                </>
              )}

              {promptType === 'recall' && (
                <p className="flashcard-word-large">{card.translation}</p>
              )}

              {promptType === 'guided-cloze' && (
                <div className="flashcard-stacked-sentences">
                  <p className="flashcard-sentence">
                    {card.sentence_translation
                      ? renderTildeHighlight(card.sentence_translation, 'flashcard-highlighted')
                      : card.translation}
                  </p>
                  <p className="flashcard-sentence">{renderCloze(card.example_sentence!)}</p>
                </div>
              )}

              {promptType === 'context-comprehension' && (
                <div className="flashcard-stacked-sentences">
                  <p className="flashcard-sentence">{renderCloze(card.example_sentence!)}</p>
                  <p className="flashcard-sentence">
                    {card.sentence_translation
                      ? renderCloze(card.sentence_translation)
                      : card.translation}
                  </p>
                </div>
              )}

              {promptType === 'target-cloze' && (
                <p className="flashcard-sentence">{renderCloze(card.example_sentence!)}</p>
              )}

              <p className="flashcard-hint">
                <TapIcon size={14} />
                Tap to reveal
              </p>
            </div>

            {/* Back */}
            <div className={`flashcard-back${useBlue ? ' flashcard-back--recognition' : ''}`}>

              {promptType === 'recognition' && (
                <>
                  <p className="flashcard-back-translation flashcard-recognition-answer">
                    <strong>{card.word}</strong> — {card.translation}
                  </p>
                  {card.definition && (
                    <p className="flashcard-back-definition">{card.definition}</p>
                  )}
                  {hasExample && (
                    <p className="flashcard-sentence">{renderTildeHighlight(card.example_sentence!, 'flashcard-highlighted')}</p>
                  )}
                  {card.sentence_translation && (
                    <p className="flashcard-sentence-translation">{card.sentence_translation}</p>
                  )}
                </>
              )}

              {promptType === 'recall' && (
                <>
                  <p className="flashcard-word-large flashcard-highlighted">{card.word}</p>
                  {card.image_url && (
                    <img className="flashcard-image" src={proxyImageUrl(card.image_url)!} alt={card.word} loading="lazy" />
                  )}
                  {card.definition && (
                    <p className="flashcard-back-definition">{card.definition}</p>
                  )}
                  {hasExample && (
                    <p className="flashcard-sentence">{renderTildeHighlight(card.example_sentence!, 'flashcard-highlighted')}</p>
                  )}
                </>
              )}

              {promptType === 'guided-cloze' && (
                <>
                  <p className="flashcard-sentence">{renderTildeHighlight(card.example_sentence!, 'flashcard-highlighted')}</p>
                  {card.sentence_translation && (
                    <p className="flashcard-sentence-translation">{card.sentence_translation}</p>
                  )}
                  <p className="flashcard-back-translation">
                    <strong>{card.word}</strong> — {card.translation}
                  </p>
                </>
              )}

              {promptType === 'context-comprehension' && (
                <>
                  <p className="flashcard-sentence">{renderTildeHighlight(card.example_sentence!, 'flashcard-highlighted')}</p>
                  {card.sentence_translation && (
                    <p className="flashcard-sentence">{renderTildeHighlight(card.sentence_translation, 'flashcard-highlighted')}</p>
                  )}
                  <p className="flashcard-back-translation">
                    <strong>{card.word}</strong> — {card.translation}
                  </p>
                </>
              )}

              {promptType === 'target-cloze' && (
                <>
                  <p className="flashcard-sentence">{renderTildeHighlight(card.example_sentence!, 'flashcard-highlighted')}</p>
                  <p className="flashcard-back-translation">
                    <strong>{card.word}</strong> — {card.translation}
                  </p>
                </>
              )}

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
                <SpeakerIcon size={20} />
              </button>
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
        </button>
        <button
          className="flashcard-btn flashcard-btn--good"
          disabled={!isFlipped}
          onClick={() => handleAnswer('good')}
        >
          <CheckIcon size={18} strokeWidth={2.5} />
          <span className="flashcard-btn-label">Correct</span>
          <span className="flashcard-btn-time">{getButtonTimeLabel(card, 'good')}</span>
        </button>
      </div>
    </div>
  );
}
