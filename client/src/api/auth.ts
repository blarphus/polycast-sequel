import { request } from './core';

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  native_language: string | null;
  target_language: string | null;
  daily_new_limit: number;
  account_type: 'student' | 'teacher';
  cefr_level: string | null;
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

export function updateSettings(
  native_language: string | null,
  target_language: string | null,
  daily_new_limit?: number,
  account_type?: 'student' | 'teacher',
  cefr_level?: string | null,
) {
  const body: Record<string, unknown> = { native_language, target_language };
  if (daily_new_limit !== undefined) body.daily_new_limit = daily_new_limit;
  if (account_type !== undefined) body.account_type = account_type;
  if (cefr_level !== undefined) body.cefr_level = cefr_level;
  return request<AuthUser>('/me/settings', {
    method: 'PATCH',
    body,
  });
}
