import { request } from './core';
import type { SavedWord } from './dictionary';
import type { PendingClasswork } from './classwork';

export interface StudentDashboard {
  newToday: SavedWord[];
  dueWords: SavedWord[];
  pendingClasswork: PendingClasswork;
}

export function getStudentDashboard() {
  return request<StudentDashboard>('/home/student-dashboard');
}
