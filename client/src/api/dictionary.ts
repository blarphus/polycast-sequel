import { request } from './core';

export interface EnrichedWord {
  word: string;
  translation: string;
  definition: string;
  part_of_speech: string | null;
  frequency: number | null;
  frequency_count: number | null;
  example_sentence: string | null;
  sentence_translation: string | null;
  image_url: string | null;
  lemma: string | null;
  forms: string | null;
  image_term: string | null;
  fallback_notices?: Array<{
    title?: string;
    message?: string;
    detail?: string;
  }>;
}

export function getNewToday() {
  const params = new URLSearchParams({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  return request<SavedWord[]>(`/dictionary/new-today?${params}`, { cacheTtlMs: 15_000 });
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
    gemini_definition: string | null;
    part_of_speech: string | null;
    sense_index: number | null;
    matched_gloss: string | null;
    lemma: string | null;
    is_native: boolean;
    is_existing?: boolean;
    saved_word_id?: string | null;
    definition_source: string | null;
    example: string | null;
    example_translation: string | null;
    sentence_translation: string | null;
    // Set when the clicked word is part of a fixed phrase/idiom/slang.
    is_phrase?: boolean;
    phrase?: string | null;
    phrase_translation?: string | null;
    phrase_definition?: string | null;
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

// Gemini explains what the word means specifically in its sentence context.
export function explainWord(word: string, sentence: string, nativeLang: string, targetLang?: string, context?: string) {
  const params = new URLSearchParams({ word, sentence, nativeLang });
  if (targetLang) params.set('targetLang', targetLang);
  // Wider rolling-window passage so the explanation reads usage beyond the line.
  if (context && context.trim() && context.trim() !== sentence) params.set('context', context.trim());
  return request<{ word: string; explanation: string }>(`/dictionary/explain?${params}`);
}

export function explainSelection(selection: string, context: string, nativeLang: string, targetLang?: string) {
  return request<{ selection: string; explanation: string }>('/dictionary/explain-selection', {
    method: 'POST',
    body: { selection, context, nativeLang, targetLang },
  });
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
  projected_due_at?: string | null;
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
  introduced_date: string | null;
  relearning_date: string | null;
}

export function getSavedWords(targetLanguage?: string | null) {
  const params = new URLSearchParams({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  if (targetLanguage) params.set('targetLanguage', targetLanguage);
  return request<SavedWord[]>(`/dictionary/words?${params}`, { cacheTtlMs: 30_000 });
}

export type DictionarySortMode = 'queue' | 'date' | 'az' | 'freq-high' | 'freq-low' | 'due';

export interface DictionaryWordGroup {
  key: string;
  word: string;
  target_language: string | null;
  entries: SavedWord[];
  primaryEntry: SavedWord;
  hasNew: boolean;
  hasPriority: boolean;
  maxFrequency: number | null;
  maxFrequencyCount?: number | null;
  earliestDueTime: number;
  earliestCreatedTime: number;
  mostRecentCreatedTime: number;
}

export interface DictionaryWordGroupPage {
  groups: DictionaryWordGroup[];
  dueNextGroupKeys: string[];
  page: number;
  totalGroups: number;
  totalPages: number;
}

export function getDictionaryWordGroups(page: number, limit: number, search: string, sort: DictionarySortMode) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    search,
    sort,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return request<DictionaryWordGroupPage>(`/dictionary/word-groups?${params}`, { cacheTtlMs: 30_000 });
}

export function saveWord(data: SaveWordData) {
  return request<SavedWord & { _created: boolean }>('/dictionary/words', {
    method: 'POST',
    body: {
      ...data,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
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

export type SrsAnswer = 'again' | 'good';

export function getDueWords() {
  const params = new URLSearchParams({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  return request<SavedWord[]>(`/dictionary/due?${params}`, { cacheTtlMs: 10_000 });
}

export function reviewWord(id: string, answer: SrsAnswer) {
  return request<SavedWord>(`/dictionary/words/${id}/review`, {
    method: 'PATCH',
    body: { answer, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
}

export function reorderQueue(items: Array<{ id: string; queue_position: number }>) {
  return request<void>('/dictionary/queue-reorder', {
    method: 'PATCH',
    body: { items },
  });
}

export interface CalendarDayCount {
  date: string;
  count: number;
}

export interface CalendarCounts {
  days: CalendarDayCount[];
  newToday: number;
}

export function getCalendarCounts(year: number, month: number) {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return request<CalendarCounts>(`/dictionary/calendar?${params}`);
}

export function getCalendarDayWords(date: string) {
  const params = new URLSearchParams({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  return request<SavedWord[]>(`/dictionary/calendar/${date}?${params}`);
}
