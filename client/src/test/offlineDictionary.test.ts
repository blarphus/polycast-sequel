import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
