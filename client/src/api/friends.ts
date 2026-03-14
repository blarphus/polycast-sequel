import { request } from './core';

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
  return request<Friend[]>('/friends', { cacheTtlMs: 15_000 });
}

export function getPendingRequests() {
  return request<FriendRequest[]>('/friends/requests', { cacheTtlMs: 15_000 });
}

export function acceptFriendRequest(id: string) {
  return request<void>(`/friends/${id}/accept`, { method: 'POST' });
}

export function rejectFriendRequest(id: string) {
  return request<void>(`/friends/${id}/reject`, { method: 'POST' });
}
