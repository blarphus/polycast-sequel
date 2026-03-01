// ---------------------------------------------------------------------------
// api.ts -- REST fetch wrappers (cookie-based auth, credentials: 'include')
// ---------------------------------------------------------------------------

const BASE = '/api';

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function request<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = opts;

  const fetchOpts: RequestInit = {
    method,
    credentials: 'include',
    headers: { ...headers },
  };

  if (body !== undefined && !(body instanceof FormData)) {
    (fetchOpts.headers as Record<string, string>)['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    // Let browser set Content-Type with boundary for FormData
    fetchOpts.body = body;
  }

  const res = await fetch(`${BASE}${path}`, fetchOpts);

  if (!res.ok) {
    let payload: any;
    try {
      payload = await res.json();
    } catch (parseErr) {
      console.error(`${method} ${path} — failed to parse error response (${res.status}):`, parseErr);
      throw new Error(`${method} ${path} failed (${res.status} ${res.statusText})`);
    }
    throw new Error(payload.error ?? payload.message ?? `${method} ${path} failed (${res.status})`);
  }

  // 204 No Content – nothing to parse
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

// ---- Auth ----------------------------------------------------------------

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  native_language: string | null;
  target_language: string | null;
  daily_new_limit: number;
  account_type: 'student' | 'teacher';
}

export function signup(username: string, password: string, displayName: string) {
  return request<AuthUser>('/signup', {
    method: 'POST',
    body: { username, password, display_name: displayName },
  });
}

export function login(username: string, password: string) {
  return request<AuthUser>('/login', {
    method: 'POST',
    body: { username, password },
  });
}

export function logout() {
  return request<void>('/logout', { method: 'POST' });
}

export function getMe() {
  return request<AuthUser>('/me');
}

export function updateSettings(native_language: string | null, target_language: string | null, daily_new_limit?: number, account_type?: 'student' | 'teacher') {
  const body: Record<string, unknown> = { native_language, target_language };
  if (daily_new_limit !== undefined) body.daily_new_limit = daily_new_limit;
  if (account_type !== undefined) body.account_type = account_type;
  return request<AuthUser>('/me/settings', {
    method: 'PATCH',
    body,
  });
}

export function getNewToday() {
  return request<SavedWord[]>('/dictionary/new-today');
}

// ---- ICE Servers (WebRTC) ------------------------------------------------

export function getIceServers() {
  return request<{ iceServers: RTCIceServer[] }>('/ice-servers');
}

// ---- Users / Calls -------------------------------------------------------

export interface UserResult {
  id: string;
  username: string;
  display_name: string;
  online?: boolean;
}

export function searchUsers(query: string, accountType?: string) {
  const params = new URLSearchParams({ q: query });
  if (accountType) params.set('account_type', accountType);
  return request<UserResult[]>(`/users/search?${params}`);
}

// ---- Friends -------------------------------------------------------------

export interface Friend {
  id: string;
  friendship_id: string;
  username: string;
  display_name: string;
  online: boolean;
}

export interface FriendRequest {
  id: string;
  requester_id: string;
  username: string;
  display_name: string;
  created_at: string;
}

export function sendFriendRequest(userId: string | number) {
  return request<{ id: string }>('/friends/request', {
    method: 'POST',
    body: { userId },
  });
}

export function getFriends() {
  return request<Friend[]>('/friends');
}

export function getPendingRequests() {
  return request<FriendRequest[]>('/friends/requests');
}

export function acceptFriendRequest(id: string) {
  return request<void>(`/friends/${id}/accept`, { method: 'POST' });
}

export function rejectFriendRequest(id: string) {
  return request<void>(`/friends/${id}/reject`, { method: 'POST' });
}

// ---- Conversations / Messages ----------------------------------------------

export interface Conversation {
  friend_id: string;
  friend_username: string;
  friend_display_name: string;
  online: boolean;
  last_message_body: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
  unread_count: number;
}

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface MessagesPage {
  messages: Message[];
  has_more: boolean;
}

export function getConversations() {
  return request<Conversation[]>('/conversations');
}

export function getMessages(friendId: string, before?: string, limit?: number) {
  const params = new URLSearchParams();
  if (before) params.set('before', before);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return request<MessagesPage>(`/messages/${friendId}${qs ? `?${qs}` : ''}`);
}

export function sendMessage(friendId: string, body: string) {
  return request<Message>(`/messages/${friendId}`, { method: 'POST', body: { body } });
}

export function markMessagesRead(friendId: string) {
  return request<{ updated: number }>(`/messages/${friendId}/read`, { method: 'POST' });
}

// ---- Dictionary / Word Lookup ---------------------------------------------

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

export function lookupWord(word: string, sentence: string, nativeLang: string, targetLang?: string) {
  const params = new URLSearchParams({ word, sentence, nativeLang });
  if (targetLang) params.set('targetLang', targetLang);
  return request<{ word: string; valid: boolean; translation: string; definition: string; part_of_speech: string | null; sense_index: number | null; matched_gloss: string | null; lemma: string | null }>(`/dictionary/lookup?${params}`);
}

export interface WiktSense { gloss: string; pos: string; tags: string[]; example: { text: string; translation: string | null } | null; }
export interface WiktLookupResult { word: string; senses: WiktSense[]; }

export function wiktLookup(word: string, targetLang: string, nativeLang: string) {
  const params = new URLSearchParams({ word, targetLang, nativeLang });
  return request<WiktLookupResult>(`/dictionary/wikt-lookup?${params}`);
}

export function enrichWord(word: string, sentence: string, nativeLang: string, targetLang?: string, senseIndex?: number | null) {
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

/** Route Pixabay image URLs through the server proxy to avoid CDN rate-limiting. */
export function proxyImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith('https://pixabay.com/')) return url;
  return `/api/dictionary/image-proxy?url=${encodeURIComponent(url)}`;
}

// ---- Saved Words (Personal Dictionary) ------------------------------------

export interface SaveWordData {
  word: string;
  translation: string;
  definition: string;
  target_language?: string;
  sentence_context?: string;
  frequency?: number | null;
  frequency_count?: number | null;
  example_sentence?: string | null;
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
  priority: boolean;
  image_term: string | null;
}

export function getSavedWords() {
  return request<SavedWord[]>('/dictionary/words');
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

// ---- SRS / Learn ----------------------------------------------------------

export type SrsAnswer = 'again' | 'hard' | 'good' | 'easy';

export function getDueWords() {
  return request<SavedWord[]>('/dictionary/due');
}

export function reviewWord(id: string, answer: SrsAnswer) {
  return request<SavedWord>(`/dictionary/words/${id}/review`, {
    method: 'PATCH',
    body: { answer },
  });
}

// ---- Classroom (Teacher) --------------------------------------------------

export interface ClassroomStudent {
  classroom_id: string;
  id: string;
  username: string;
  display_name: string;
  online: boolean;
  added_at: string;
}

export interface StudentStats {
  totalWords: number;
  wordsLearned: number;
  wordsDue: number;
  wordsNew: number;
  wordsInLearning: number;
  totalReviews: number;
  accuracy: number | null;
  lastReviewedAt: string | null;
}

export interface StudentWord {
  id: string;
  word: string;
  translation: string;
  part_of_speech: string | null;
}

export interface StudentDetail {
  student: { id: string; username: string; display_name: string };
  stats: StudentStats;
  words: StudentWord[];
}

export function getClassroomStudents() {
  return request<ClassroomStudent[]>('/classroom/students');
}

export function addClassroomStudent(studentId: string) {
  return request<{ id: string }>('/classroom/students', {
    method: 'POST',
    body: { studentId },
  });
}

export function removeClassroomStudent(studentId: string) {
  return request<void>(`/classroom/students/${studentId}`, { method: 'DELETE' });
}

export function getStudentStats(studentId: string) {
  return request<StudentDetail>(`/classroom/students/${studentId}/stats`);
}

// ---- Stream (Classwork) ---------------------------------------------------

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

export interface StreamPost {
  id: string;
  teacher_id: string;
  type: 'material' | 'word_list' | 'lesson';
  title: string | null;
  body: string | null;
  attachments: StreamAttachment[];
  lesson_items?: LessonItem[];
  target_language: string | null;
  created_at: string;
  updated_at: string;
  word_count?: number;
  words?: StreamPostWord[];
  known_word_ids?: string[];
  completed?: boolean;
  teacher_name?: string;
  topic_id?: string | null;
  position?: number;
}

export interface StreamTopic {
  id: string;
  teacher_id: string;
  title: string;
  position: number;
  created_at: string;
  teacher_name?: string;
}

export function getStream() {
  return request<{ topics: StreamTopic[]; posts: StreamPost[] }>('/stream');
}

export function createPost(data: {
  type: 'material' | 'word_list' | 'lesson';
  title: string;
  body?: string;
  attachments?: StreamAttachment[];
  words?: (string | WordOverride)[];
  target_language?: string;
  lesson_items?: LessonItem[];
  topic_id?: string | null;
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

// ---- Pending Classwork (Student) -------------------------------------------

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

// ---- Videos ---------------------------------------------------------------

export interface VideoSummary {
  id: string;
  youtube_id: string;
  title: string;
  channel: string;
  language: string;
  duration_seconds: number | null;
  transcript_status: 'missing' | 'processing' | 'ready' | 'failed';
  transcript_source?: 'manual' | 'auto' | 'none';
  cefr_level: string | null;
}

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

export interface VideoDetail extends VideoSummary {
  transcript: TranscriptSegment[] | null;
  transcript_last_error?: string | null;
  transcript_error?: string;
}

export function getVideos() {
  return request<VideoSummary[]>('/videos');
}

export function getVideo(id: string) {
  return request<VideoDetail>(`/videos/${id}`);
}

export function addVideo(url: string, language: string) {
  return request<VideoDetail>('/videos', { method: 'POST', body: { url, language } });
}

export function retryVideoTranscript(id: string) {
  return request<VideoDetail>(`/videos/${id}/transcript/retry`, { method: 'POST' });
}
