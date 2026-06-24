import { request } from './core';
import type { SavedWord } from './dictionary';
import type { PendingClasswork } from './classwork';

export interface StudentDashboard {
  newToday: SavedWord[];
  dueWords: SavedWord[];
  pendingClasswork: PendingClasswork;
}

export function getStudentDashboard() {
  const params = new URLSearchParams({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  return request<StudentDashboard>(`/home/student-dashboard?${params}`, { cacheTtlMs: 15_000 });
}
