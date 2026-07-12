import { request } from './core';
import type { SavedWord } from './dictionary';

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

export interface StudentDashboard {
  newToday: SavedWord[];
  dueWords: SavedWord[];
  pendingClasswork: PendingClasswork;
  wordsAddedToday: number;
}

export function getStudentDashboard() {
  const params = new URLSearchParams({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  return request<StudentDashboard>(`/home/student-dashboard?${params}`, { cacheTtlMs: 15_000 });
}
