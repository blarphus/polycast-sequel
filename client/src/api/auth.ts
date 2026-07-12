import { request } from './core';
import type { AuthSession, AuthUser } from '../generated/apiContract';

export type { AuthSession, AuthUser } from '../generated/apiContract';

export function signup(username: string, password: string, displayName: string) {
  return request<AuthSession>('/signup', {
    method: 'POST',
    body: { username, password, display_name: displayName },
  });
}

export function login(username: string, password: string) {
  return request<AuthSession>('/login', {
    method: 'POST',
    body: { username, password },
  });
}

export function restoreSession(token: string) {
  return request<AuthSession>('/session/restore', {
    method: 'POST',
    body: { token },
  });
}

export function exportSessionToken() {
  return request<{ token: string }>('/session/export', {
    method: 'POST',
  });
}

export function getProfileAccounts() {
  return request<{ accounts: import('../utils/savedAccounts').SavedAccount[] }>('/session/accounts');
}

export function switchProfile(userId: string) {
  return request<AuthUser>('/session/switch', { method: 'POST', body: { userId } });
}

export function forgetProfile(userId: string) {
  return request<{ success: boolean }>(`/session/accounts/${encodeURIComponent(userId)}`, { method: 'DELETE' });
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
  daily_word_goal?: number,
) {
  const body: Record<string, unknown> = { native_language, target_language };
  if (daily_new_limit !== undefined) body.daily_new_limit = daily_new_limit;
  // account_type is a privileged server-managed role.
  void account_type;
  if (cefr_level !== undefined) body.cefr_level = cefr_level;
  if (daily_word_goal !== undefined) body.daily_word_goal = daily_word_goal;
  return request<AuthUser>('/me/settings', {
    method: 'PATCH',
    body,
  });
}
