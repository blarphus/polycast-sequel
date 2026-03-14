import { request } from './core';

export interface UpcomingClass {
  id: string;
  title: string | null;
  teacher_name: string;
  teacher_id: string;
  scheduled_at: string | null;
  duration_minutes: number | null;
  time: string | null;
}

export interface GroupCallParticipant {
  userId: string;
  displayName: string;
  username: string;
}

export function getClassesToday() {
  return request<{ classes: UpcomingClass[] }>('/classes/today', { cacheTtlMs: 30_000 });
}

export function joinGroupCall(postId: string) {
  return request<{ groupCallId: string; participants: GroupCallParticipant[] }>(`/group-call/${postId}/join`, { method: 'POST' });
}

export function leaveGroupCall(postId: string) {
  return request<void>(`/group-call/${postId}/leave`, { method: 'POST' });
}
