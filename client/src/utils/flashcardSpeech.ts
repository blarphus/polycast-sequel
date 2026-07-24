import type { SavedWord } from '../api';
import { stripTildes } from './tildeMarkup';

export type PromptType = 'meet-word' | 'sentence-meaning' | 'word-production' | 'sentence-production';

export function getPromptType(card: SavedWord): PromptType {
  const hasExample = !!card.example_sentence;
  const hasSentenceTranslation = !!card.sentence_translation;
  const stage = card.prompt_stage ?? 0;
  if (stage === 0) return 'meet-word';
  if (stage === 1) return hasExample && hasSentenceTranslation ? 'sentence-meaning' : 'word-production';
  if (stage === 2) return 'word-production';
  return hasExample && hasSentenceTranslation ? 'sentence-production' : 'word-production';
}

export function spokenText(card: SavedWord, promptType: PromptType, back: boolean): string | null {
  const example = card.example_sentence ? stripTildes(card.example_sentence) : null;
  if (!back) {
    if (promptType === 'meet-word') return example || card.word;
    if (promptType === 'sentence-meaning') return example;
    return null;
  }
  if (promptType === 'word-production') return example ? `${card.word}. ${example}` : card.word;
  if (promptType === 'sentence-production') return example || card.word;
  return null;
}

export function cardSpeechTexts(card: SavedWord) {
  const promptType = getPromptType(card);
  return Array.from(new Set(
    [spokenText(card, promptType, false), spokenText(card, promptType, true)]
      .filter((text): text is string => Boolean(text)),
  ));
}
