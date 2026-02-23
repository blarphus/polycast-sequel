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

// ---- Transcription -------------------------------------------------------

export interface TranscribeResult {
  text: string;
  lang: string;
}

export function transcribe(audioBlob: Blob) {
  const form = new FormData();
  form.append('audio', audioBlob, 'recording.webm');
  return request<TranscribeResult>('/transcribe', {
    method: 'POST',
    body: form,
  });
}
