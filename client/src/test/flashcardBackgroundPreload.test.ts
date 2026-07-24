import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedWord } from '../api';
import {
  prefetchFlashcards,
  prepareFlashcardsForStudy,
  resetFlashcardPreload,
} from '../utils/flashcardPreload';
import appSource from '../App.tsx?raw';

const { getDueWords, preloadAiSpeech, preloadCardAudio } = vi.hoisted(() => ({
  getDueWords: vi.fn(),
  preloadAiSpeech: vi.fn(),
  preloadCardAudio: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, getDueWords };
});

vi.mock('../utils/aiSpeech', () => ({
  preloadAiSpeech,
  preloadCardAudio,
}));

const card = {
  id: 'card-1',
  word: 'sacar',
  target_language: 'es',
  example_sentence: 'Saco la basura.',
  sentence_translation: 'I take out the trash.',
  prompt_stage: 0,
} as SavedWord;

describe('authenticated flashcard background preload', () => {
  beforeEach(() => {
    resetFlashcardPreload();
    vi.clearAllMocks();
    getDueWords.mockResolvedValue([card]);
    preloadAiSpeech.mockResolvedValue({
      url: 'blob:sentence',
      usedFallback: false,
      startOffsetSeconds: 0,
    });
    preloadCardAudio.mockResolvedValue({
      url: 'blob:word',
      usedFallback: false,
      startOffsetSeconds: 0,
    });
  });

  it('starts loading the route, due cards, and audio from the authenticated shell', async () => {
    expect(appSource).toContain("import('./pages/Learn')");
    expect(appSource).toContain("import('./utils/flashcardPreload')");
    expect(appSource).toContain('prefetchFlashcards(userId)');

    await prefetchFlashcards('user-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getDueWords).toHaveBeenCalledOnce();
    expect(preloadAiSpeech).toHaveBeenCalledWith('Saco la basura.', 'es');
  });

  it('reuses the prefetched due-card request when Flashcards is opened', async () => {
    await prefetchFlashcards('user-1');
    const cards = await prepareFlashcardsForStudy('user-1');

    expect(cards).toEqual([card]);
    expect(getDueWords).toHaveBeenCalledOnce();
  });
});
