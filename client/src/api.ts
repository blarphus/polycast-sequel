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
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(payload.error ?? payload.message ?? `Request failed (${res.status})`);
  }

  // 204 No Content – nothing to parse
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

// ---- Auth ----------------------------------------------------------------

export interface AuthUser {
  id: number;
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
  id: number;
  username: string;
  display_name: string;
  online?: boolean;
}

export function searchUsers(query: string) {
  return request<UserResult[]>(`/users/search?q=${encodeURIComponent(query)}`);
}

export interface CallRecord {
  id: number;
  caller_id: number;
  callee_id: number;
  caller_username: string;
  callee_username: string;
  caller_display_name: string;
  callee_display_name: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
}

export function getCallHistory() {
  return request<CallRecord[]>('/calls');
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

export function removeFriend(id: string) {
  return request<void>(`/friends/${id}`, { method: 'DELETE' });
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

export interface WordLookup {
  word: string;
  translation: string;
  definition: string;
  part_of_speech: string | null;
}

export interface EnrichedWord {
  word: string;
  translation: string;
  definition: string;
  part_of_speech: string | null;
  frequency: number | null;
  example_sentence: string | null;
}

export function lookupWord(word: string, sentence: string, nativeLang: string, targetLang?: string) {
  const params = new URLSearchParams({ word, sentence, nativeLang });
  if (targetLang) params.set('targetLang', targetLang);
  return request<WordLookup>(`/dictionary/lookup?${params}`);
}

export function enrichWord(word: string, sentence: string, nativeLang: string, targetLang?: string) {
  return request<EnrichedWord>('/dictionary/enrich', {
    method: 'POST',
    body: { word, sentence, nativeLang, targetLang },
  });
}

export function translateSentence(sentence: string, fromLang: string, toLang: string) {
  return request<{ translation: string }>('/dictionary/translate', {
    method: 'POST',
    body: { sentence, fromLang, toLang },
  });
}

// ---- Saved Words (Personal Dictionary) ------------------------------------

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
}

export function getSavedWords() {
  return request<SavedWord[]>('/dictionary/words');
}

export function saveWord(data: {
  word: string;
  translation: string;
  definition: string;
  target_language?: string;
  sentence_context?: string;
  frequency?: number | null;
  example_sentence?: string | null;
  part_of_speech?: string | null;
}) {
  return request<SavedWord>('/dictionary/words', { method: 'POST', body: data });
}

export function deleteSavedWord(id: string) {
  return request<void>(`/dictionary/words/${id}`, { method: 'DELETE' });
}

