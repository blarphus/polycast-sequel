import { request } from './core';

function withClassroomQuery(path: string, classroomId?: string | null) {
  if (!classroomId) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}classroomId=${encodeURIComponent(classroomId)}`;
}

export interface StreamAttachment {
  url: string;
  label: string;
}

export interface LessonItem {
  title: string;
  body?: string;
  attachments: StreamAttachment[];
}

export interface StreamPostWord {
  id: string;
  post_id: string;
  word: string;
  translation: string;
  definition: string;
  part_of_speech: string | null;
  position: number | null;
  frequency?: number | null;
  frequency_count?: number | null;
  example_sentence?: string | null;
  image_url?: string | null;
  lemma?: string | null;
  forms?: string | null;
  image_term?: string | null;
}

export type WordOverride = {
  word: string;
  translation?: string;
  definition?: string;
  part_of_speech?: string | null;
  frequency?: number | null;
  frequency_count?: number | null;
  example_sentence?: string | null;
  image_url?: string | null;
  lemma?: string | null;
  forms?: string | null;
};

export interface Recurrence {
  days: number[];
  time: string;
  until: string;
}

export interface StreamPost {
  id: string;
  teacher_id: string;
  type: 'material' | 'word_list' | 'lesson' | 'class_session';
  title: string | null;
  body: string | null;
  attachments: StreamAttachment[];
  lesson_items?: LessonItem[];
  target_language: string | null;
  created_at: string;
  updated_at: string;
  word_count?: number;
  completed_count?: number;
  words?: StreamPostWord[];
  known_word_ids?: string[];
  completed?: boolean;
  teacher_name?: string;
  topic_id?: string | null;
  position?: number;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  recurrence?: Recurrence | null;
}

export interface StreamTopic {
  id: string;
  teacher_id: string;
  title: string;
  position: number;
  created_at: string;
  teacher_name?: string;
}

export function getStream(classroomId?: string | null) {
  return request<{ topics: StreamTopic[]; posts: StreamPost[]; student_count?: number }>(withClassroomQuery('/stream', classroomId));
}

export interface PostCompletionStudent {
  id: string;
  username: string;
  display_name: string;
  completed: boolean;
  completed_at: string | null;
}

export interface PostCompletions {
  total: number;
  completed: number;
  students: PostCompletionStudent[];
}

export function getPostCompletions(postId: string) {
  return request<PostCompletions>(`/stream/posts/${postId}/completions`);
}

export function createPost(data: {
  type: 'material' | 'word_list' | 'lesson' | 'class_session';
  title: string;
  body?: string;
  attachments?: StreamAttachment[];
  words?: (string | WordOverride)[];
  target_language?: string;
  lesson_items?: LessonItem[];
  topic_id?: string | null;
  scheduled_at?: string;
  duration_minutes?: number;
  recurrence?: Recurrence | null;
}) {
  return request<StreamPost>('/stream/posts', { method: 'POST', body: data });
}

export function enrichPostStream(postId: string): EventSource {
  return new EventSource(`/api/stream/posts/${postId}/enrich`, { withCredentials: true });
}

export function updatePost(postId: string, data: {
  title?: string;
  body?: string;
  attachments?: StreamAttachment[];
  lesson_items?: LessonItem[];
  topic_id?: string | null;
  words?: WordOverride[];
  target_language?: string;
}) {
  return request<StreamPost>(`/stream/posts/${postId}`, { method: 'PATCH', body: data });
}

export function createTopic(title: string) {
  return request<StreamTopic>('/stream/topics', { method: 'POST', body: { title } });
}

export function updateTopic(id: string, data: { title?: string }) {
  return request<StreamTopic>(`/stream/topics/${id}`, { method: 'PATCH', body: data });
}

export function deleteTopic(id: string) {
  return request<void>(`/stream/topics/${id}`, { method: 'DELETE' });
}

export function reorderStream(
  items: Array<{ id: string; kind: 'post' | 'topic'; position: number; topic_id?: string | null }>,
) {
  return request<void>('/stream/reorder', { method: 'PATCH', body: { items } });
}

export function deletePost(postId: string) {
  return request<void>(`/stream/posts/${postId}`, { method: 'DELETE' });
}

export function toggleWordKnown(postId: string, postWordId: string, known: boolean) {
  return request<void>(`/stream/posts/${postId}/known`, {
    method: 'POST',
    body: { postWordId, known },
  });
}

export function addPostToDictionary(postId: string) {
  return request<{ added: number; skipped: number }>(`/stream/posts/${postId}/add-to-dictionary`, {
    method: 'POST',
  });
}

export function lookupPostWords(words: string[], nativeLang: string, targetLang: string) {
  return request<{ words: StreamPostWord[] }>('/stream/words/lookup', {
    method: 'POST',
    body: { words, nativeLang, targetLang },
  });
}

export function batchTranslateWords(
  words: { word: string; definition: string }[],
  nativeLang: string,
  allWords?: string[],
) {
  return request<{ translations: ({ translation: string; definition: string } | null)[] }>('/stream/words/batch-translate', {
    method: 'POST',
    body: { words, nativeLang, allWords },
  });
}

export interface PendingWordList {
  id: string;
  title: string;
  word_count: number;
  teacher_name: string;
  created_at: string;
}

export interface PendingClasswork {
  count: number;
  posts: PendingWordList[];
}

export function getPendingClasswork() {
  return request<PendingClasswork>('/stream/pending');
}

export function generateExampleSentence(word: string, targetLang: string, definition?: string) {
  const body: Record<string, unknown> = { word, targetLang };
  if (definition) body.definition = definition;
  return request<{ example_sentence: string | null }>('/stream/words/example', {
    method: 'POST',
    body,
  });
}
