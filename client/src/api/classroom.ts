import { request } from './core';

export interface ClassroomStudent {
  classroom_id: string;
  id: string;
  username: string;
  display_name: string;
  online: boolean;
  added_at: string;
}

export interface StudentStats {
  totalWords: number;
  wordsLearned: number;
  wordsDue: number;
  wordsNew: number;
  wordsInLearning: number;
  totalReviews: number;
  accuracy: number | null;
  lastReviewedAt: string | null;
}

export interface StudentWord {
  id: string;
  word: string;
  translation: string;
  part_of_speech: string | null;
}

export interface StudentDetail {
  student: { id: string; username: string; display_name: string };
  stats: StudentStats;
  words: StudentWord[];
}

export function getClassroomStudents() {
  return request<ClassroomStudent[]>('/classroom/students');
}

export function addClassroomStudent(studentId: string) {
  return request<{ id: string }>('/classroom/students', {
    method: 'POST',
    body: { studentId },
  });
}

export function removeClassroomStudent(studentId: string) {
  return request<void>(`/classroom/students/${studentId}`, { method: 'DELETE' });
}

export function getStudentStats(studentId: string) {
  return request<StudentDetail>(`/classroom/students/${studentId}/stats`);
}
