import { request } from './core';

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
