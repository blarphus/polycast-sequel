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

export function updateSettings(native_language: string | null, target_language: string | null) {
  return request<AuthUser>('/me/settings', {
    method: 'PATCH',
    body: { native_language, target_language },
  });
}

// ---- Users / Calls -------------------------------------------------------

export interface UserResult {
  id: string;
  username: string;
  display_name: string;
  online?: boolean;
}

export function searchUsers(query: string) {
  return request<UserResult[]>(`/users/search?q=${encodeURIComponent(query)}`);
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

interface EnrichedWord {
  word: string;
  translation: string;
  definition: string;
  part_of_speech: string | null;
  frequency: number | null;
  example_sentence: string | null;
  image_url: string | null;
}

export function lookupWord(word: string, sentence: string, nativeLang: string, targetLang?: string) {
  const params = new URLSearchParams({ word, sentence, nativeLang });
  if (targetLang) params.set('targetLang', targetLang);
  return request<{ word: string; valid: boolean; translation: string; definition: string; part_of_speech: string | null; image_term: string }>(`/dictionary/lookup?${params}`);
}

export interface WiktSense { gloss: string; pos: string; tags: string[]; }
export interface WiktLookupResult { word: string; senses: WiktSense[]; }

export function wiktLookup(word: string, targetLang: string, nativeLang: string) {
  const params = new URLSearchParams({ word, targetLang, nativeLang });
  return request<WiktLookupResult>(`/dictionary/wikt-lookup?${params}`);
}

export function enrichWord(word: string, sentence: string, nativeLang: string, targetLang?: string, imageTerm?: string) {
  return request<EnrichedWord>('/dictionary/enrich', {
    method: 'POST',
    body: { word, sentence, nativeLang, targetLang, imageTerm },
  });
}

export function translateSentence(sentence: string, fromLang: string, toLang: string) {
  return request<{ translation: string }>('/dictionary/translate', {
    method: 'POST',
    body: { sentence, fromLang, toLang },
  });
}

// ---- Saved Words (Personal Dictionary) ------------------------------------

export interface SaveWordData {
  word: string;
  translation: string;
  definition: string;
  target_language?: string;
  sentence_context?: string;
  frequency?: number | null;
  example_sentence?: string | null;
  part_of_speech?: string | null;
  image_url?: string | null;
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
}

export function getSavedWords() {
  return request<SavedWord[]>('/dictionary/words');
}

export function saveWord(data: SaveWordData) {
  return request<SavedWord>('/dictionary/words', { method: 'POST', body: data });
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

