import { request } from './core';

export interface EnrichedWord {
  word: string;
  translation: string;
  definition: string;
  part_of_speech: string | null;
  frequency: number | null;
  frequency_count: number | null;
  example_sentence: string | null;
  image_url: string | null;
  lemma: string | null;
  forms: string | null;
  image_term: string | null;
}

export function getNewToday() {
  return request<SavedWord[]>('/dictionary/new-today', { cacheTtlMs: 15_000 });
}

export function lookupWord(word: string, sentence: string, nativeLang: string, targetLang?: string, isNative?: boolean) {
  const params = new URLSearchParams({ word, sentence, nativeLang });
  if (targetLang) params.set('targetLang', targetLang);
  if (isNative) params.set('isNative', 'true');
  return request<{
    word: string;
    target_word: string;
    valid: boolean;
    translation: string;
    definition: string;
    part_of_speech: string | null;
    sense_index: number | null;
    matched_gloss: string | null;
    lemma: string | null;
    is_native: boolean;
    definition_source: string | null;
  }>(`/dictionary/lookup?${params}`);
}

export interface WiktSense {
  gloss: string;
  pos: string;
  tags: string[];
  example: { text: string; translation: string | null } | null;
}

export interface WiktLookupResult {
  word: string;
  senses: WiktSense[];
}

export function wiktLookup(word: string, targetLang: string, nativeLang: string) {
  const params = new URLSearchParams({ word, targetLang, nativeLang });
  return request<WiktLookupResult>(`/dictionary/wikt-lookup?${params}`);
}

export function enrichWord(
  word: string,
  sentence: string,
  nativeLang: string,
  targetLang?: string,
  senseIndex?: number | null,
) {
  const body: Record<string, unknown> = { word, sentence, nativeLang, targetLang };
  if (senseIndex != null) body.senseIndex = senseIndex;
  return request<EnrichedWord>('/dictionary/enrich', {
    method: 'POST',
    body,
  });
}

export function translateSentence(sentence: string, fromLang: string, toLang: string) {
  return request<{ translation: string }>('/dictionary/translate', {
    method: 'POST',
    body: { sentence, fromLang, toLang },
  });
}

export function proxyImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith('https://pixabay.com/')) return url;
  return `/api/dictionary/image-proxy?url=${encodeURIComponent(url)}`;
}

export interface SaveWordData {
  word: string;
  translation: string;
  definition: string;
  target_language?: string;
  sentence_context?: string;
  frequency?: number | null;
  frequency_count?: number | null;
  example_sentence?: string | null;
  sentence_translation?: string | null;
  part_of_speech?: string | null;
  image_url?: string | null;
  lemma?: string | null;
  forms?: string | null;
  image_term?: string | null;
}

export interface SavedWord {
  id: string;
  word: string;
  translation: string;
  definition: string;
  target_language: string | null;
  sentence_context: string | null;
  created_at: string;
  frequency: number | null;
  frequency_count: number | null;
  example_sentence: string | null;
  sentence_translation: string | null;
  part_of_speech: string | null;
  srs_interval: number;
  due_at: string | null;
  last_reviewed_at: string | null;
  correct_count: number;
  incorrect_count: number;
  ease_factor: number;
  learning_step: number | null;
  image_url: string | null;
  lemma: string | null;
  forms: string | null;
  prompt_stage: number;
  priority: boolean;
  image_term: string | null;
  queue_position: number | null;
}

export function getSavedWords() {
  return request<SavedWord[]>('/dictionary/words', { cacheTtlMs: 30_000 });
}

export function saveWord(data: SaveWordData) {
  return request<SavedWord & { _created: boolean }>('/dictionary/words', { method: 'POST', body: data });
}

export function deleteSavedWord(id: string) {
  return request<void>(`/dictionary/words/${id}`, { method: 'DELETE' });
}

export function searchImages(query: string) {
  return request<{ images: string[] }>(`/dictionary/image-search?q=${encodeURIComponent(query)}`);
}

export function updateWordImage(id: string, imageUrl: string) {
  return request<SavedWord>(`/dictionary/words/${id}/image`, {
    method: 'PATCH',
    body: { image_url: imageUrl },
  });
}

export type SrsAnswer = 'again' | 'hard' | 'good' | 'easy';

export function getDueWords() {
  return request<SavedWord[]>('/dictionary/due', { cacheTtlMs: 10_000 });
}

export function reviewWord(id: string, answer: SrsAnswer) {
  return request<SavedWord>(`/dictionary/words/${id}/review`, {
    method: 'PATCH',
    body: { answer },
  });
}

export function reorderQueue(items: Array<{ id: string; queue_position: number }>) {
  return request<void>('/dictionary/queue-reorder', {
    method: 'PATCH',
    body: { items },
  });
}
