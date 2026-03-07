import { request } from './core';

function withClassroomQuery(path: string, classroomId: string) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}classroomId=${encodeURIComponent(classroomId)}`;
}

function requireClassroomId(classroomId?: string | null) {
  if (!classroomId) {
    throw new Error('classroomId is required');
  }
  return classroomId;
}

export type ClassroomRole = 'owner' | 'co_teacher' | 'student';

export interface Classroom {
  id: string;
  name: string;
  section: string | null;
  subject: string | null;
  room: string | null;
  target_language: string | null;
  native_language: string | null;
  class_code: string | null;
  archived: boolean;
  is_default_migrated: boolean;
  needs_setup: boolean;
  teacher_count: number;
  student_count: number;
  teacher_names: string[];
  role: ClassroomRole | null;
  next_class_title: string | null;
  next_class_at: string | null;
}

export interface ClassroomTopic {
  id: string;
  classroom_id: string;
  title: string;
  position: number;
  created_at: string;
}

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

export function getClassrooms() {
  return request<Classroom[]>('/classrooms');
}

export function createClassroom(data: { name: string; section?: string; subject?: string; room?: string; target_language?: string; native_language?: string }) {
  return request<Classroom>('/classrooms', {
    method: 'POST',
    body: data,
  });
}

export function getClassroom(id: string) {
  return request<Classroom>(`/classrooms/${id}`);
}

export function updateClassroom(id: string, data: {
  name?: string;
  section?: string | null;
  subject?: string | null;
  room?: string | null;
  target_language?: string | null;
  native_language?: string | null;
  needs_setup?: boolean;
}) {
  return request<Classroom>(`/classrooms/${id}`, {
    method: 'PATCH',
    body: data,
  });
}

export function deleteClassroom(id: string) {
  return request<void>(`/classrooms/${id}`, { method: 'DELETE' });
}

export function getClassroomTopics(classroomId: string) {
  return request<ClassroomTopic[]>(`/classrooms/${classroomId}/topics`);
}

export function createClassroomTopic(classroomId: string, title: string) {
  return request<ClassroomTopic>(`/classrooms/${classroomId}/topics`, {
    method: 'POST',
    body: { title },
  });
}

export function getClassroomStudents(classroomId?: string | null) {
  return request<ClassroomStudent[]>(withClassroomQuery('/classroom/students', requireClassroomId(classroomId)));
}

export function addClassroomStudent(classroomIdOrStudentId: string, maybeStudentId?: string) {
  const classroomId = maybeStudentId ? classroomIdOrStudentId : undefined;
  const studentId = maybeStudentId ?? classroomIdOrStudentId;
  return request<{ classroom_id: string }>(withClassroomQuery('/classroom/students', requireClassroomId(classroomId)), {
    method: 'POST',
    body: { studentId },
  });
}

export function removeClassroomStudent(classroomIdOrStudentId: string, maybeStudentId?: string) {
  const classroomId = maybeStudentId ? classroomIdOrStudentId : undefined;
  const studentId = maybeStudentId ?? classroomIdOrStudentId;
  return request<void>(withClassroomQuery(`/classroom/students/${studentId}`, requireClassroomId(classroomId)), { method: 'DELETE' });
}

export function getStudentStats(classroomIdOrStudentId: string, maybeStudentId?: string) {
  const classroomId = maybeStudentId ? classroomIdOrStudentId : undefined;
  const studentId = maybeStudentId ?? classroomIdOrStudentId;
  return request<StudentDetail>(withClassroomQuery(`/classroom/students/${studentId}/stats`, requireClassroomId(classroomId)));
}
