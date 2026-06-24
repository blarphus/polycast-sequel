import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleOfflineRequest,
  OFFLINE_DICTIONARY_SYNC_EVENT,
  OFFLINE_WORDS_KEY,
} from '../api/offlineDictionary';
import type { DictionaryWordGroupPage, SavedWord } from '../api';

describe('offlineDictionary', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeWord(index: number, overrides: Partial<SavedWord> = {}): SavedWord {
    return {
      id: `word-${index}`,
      word: `palabra-${index}`,
      translation: '',
      definition: '',
      target_language: 'es',
      sentence_context: null,
      created_at: new Date(2026, 0, 1, 0, index).toISOString(),
      frequency: null,
      frequency_count: null,
      example_sentence: null,
      sentence_translation: null,
      part_of_speech: null,
      srs_interval: 0,
      due_at: null,
      last_reviewed_at: null,
      correct_count: 0,
      incorrect_count: 0,
      ease_factor: 2.5,
      learning_step: null,
      image_url: null,
      lemma: null,
      forms: null,
      prompt_stage: 0,
      priority: false,
      image_term: null,
      queue_position: index,
      introduced_date: null,
      relearning_date: null,
      ...overrides,
    };
  }

  it('handles offline auth/session and settings flows', async () => {
    const login = await handleOfflineRequest('/login', 'POST', { username: 'reader' });
    expect(login.handled).toBe(true);
    if (!login.handled) throw new Error('login should be handled');
    expect((login.data as { username: string }).username).toBe('reader');

    const settings = await handleOfflineRequest('/me/settings', 'PATCH', {
      native_language: 'en',
      target_language: 'pt',
      daily_new_limit: 7,
    });
    expect(settings.handled).toBe(true);
    if (!settings.handled) throw new Error('settings should be handled');
    expect((settings.data as { target_language: string; daily_new_limit: number }).target_language).toBe('pt');
    expect((settings.data as { target_language: string; daily_new_limit: number }).daily_new_limit).toBe(7);

    const me = await handleOfflineRequest('/me', 'GET');
    expect(me.handled).toBe(true);
    if (!me.handled) throw new Error('me should be handled');
    expect((me.data as { username: string }).username).toBe('reader');
  });

  it('does not fabricate offline lookup or enrichment results', async () => {
    await expect(handleOfflineRequest(
      '/dictionary/lookup?word=hola&sentence=hola%20mundo',
      'GET',
    )).resolves.toEqual({ handled: false });

    await expect(handleOfflineRequest('/dictionary/enrich', 'POST', {
      word: 'hola',
      sentence: 'hola mundo',
    })).resolves.toEqual({ handled: false });
  });

  it('supports save, grouping, and review for local dictionary words', async () => {
    const syncListener = vi.fn();
    window.addEventListener(OFFLINE_DICTIONARY_SYNC_EVENT, syncListener);

    const save = await handleOfflineRequest('/dictionary/words', 'POST', {
      word: 'hola',
      translation: '',
      definition: 'Saved offline from: hola mundo',
      target_language: 'es',
      sentence_context: 'hola mundo',
    });
    expect(save.handled).toBe(true);
    if (!save.handled) throw new Error('save should be handled');
    const saved = save.data as SavedWord & { _created: boolean };
    expect(saved._created).toBe(true);
    expect(saved.word).toBe('hola');
    expect(syncListener).toHaveBeenCalledTimes(1);

    const duplicate = await handleOfflineRequest('/dictionary/words', 'POST', {
      word: 'Hola',
      translation: '',
      definition: 'Saved offline from: hola mundo',
      target_language: 'es',
      sentence_context: 'hola mundo',
    });
    expect(duplicate.handled).toBe(true);
    if (!duplicate.handled) throw new Error('duplicate should be handled');
    expect((duplicate.data as SavedWord & { _created: boolean })._created).toBe(false);

    const groups = await handleOfflineRequest('/dictionary/word-groups?page=0&limit=10&sort=queue', 'GET');
    expect(groups.handled).toBe(true);
    if (!groups.handled) throw new Error('groups should be handled');
    expect((groups.data as DictionaryWordGroupPage).groups[0].word).toBe('hola');

    const review = await handleOfflineRequest(`/dictionary/words/${saved.id}/review`, 'PATCH', { answer: 'good' });
    expect(review.handled).toBe(true);
    if (!review.handled) throw new Error('review should be handled');
    expect((review.data as SavedWord).last_reviewed_at).toBeTruthy();

    const stored = JSON.parse(window.localStorage.getItem(OFFLINE_WORDS_KEY) || '[]') as SavedWord[];
    expect(stored).toHaveLength(1);
    expect(stored[0].correct_count).toBe(1);

    window.removeEventListener(OFFLINE_DICTIONARY_SYNC_EVENT, syncListener);
  });

  it('does not stack offline new words from missed scheduled days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 12));

    await handleOfflineRequest('/me/settings', 'PATCH', { daily_new_limit: 10 });
    const staleScheduledWords = Array.from({ length: 30 }, (_, index) => makeWord(index, {
      due_at: new Date(2026, 0, 1 + Math.floor(index / 10)).toISOString(),
    }));
    window.localStorage.setItem(OFFLINE_WORDS_KEY, JSON.stringify(staleScheduledWords));

    const due = await handleOfflineRequest('/dictionary/due', 'GET');
    expect(due.handled).toBe(true);
    if (!due.handled) throw new Error('due should be handled');
    expect(due.data as SavedWord[]).toHaveLength(10);
    expect((due.data as SavedWord[]).map((word) => word.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `word-${index}`),
    );

    const newToday = await handleOfflineRequest('/dictionary/new-today', 'GET');
    expect(newToday.handled).toBe(true);
    if (!newToday.handled) throw new Error('new-today should be handled');
    expect(newToday.data as SavedWord[]).toHaveLength(10);

    const stored = JSON.parse(window.localStorage.getItem(OFFLINE_WORDS_KEY) || '[]') as SavedWord[];
    expect(stored.filter((word) => word.due_at)).toHaveLength(0);
  });

  it('subtracts words already introduced today from the offline daily new count', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 12));

    await handleOfflineRequest('/me/settings', 'PATCH', { daily_new_limit: 10 });
    const introducedToday = Array.from({ length: 3 }, (_, index) => makeWord(index, {
      srs_interval: 0,
      learning_step: 1,
      last_reviewed_at: new Date(2026, 0, 15, 9, index).toISOString(),
      due_at: new Date(2026, 0, 16).toISOString(),
      introduced_date: '2026-01-15',
    }));
    const newWords = Array.from({ length: 20 }, (_, index) => makeWord(index + 3));
    window.localStorage.setItem(OFFLINE_WORDS_KEY, JSON.stringify([...introducedToday, ...newWords]));

    const newToday = await handleOfflineRequest('/dictionary/new-today', 'GET');
    expect(newToday.handled).toBe(true);
    if (!newToday.handled) throw new Error('new-today should be handled');
    expect(newToday.data as SavedWord[]).toHaveLength(7);
    expect((newToday.data as SavedWord[]).map((word) => word.id)).toEqual(
      Array.from({ length: 7 }, (_, index) => `word-${index + 3}`),
    );
  });
});
