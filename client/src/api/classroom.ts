import { request } from './core';
import { emitFallbackDiagnostic } from '../utils/fallbackDiagnostics';

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

export interface ClassBook {
  id: string;
  classroom_id: string;
  classroom_name: string;
  title: string;
  author: string | null;
  original_filename: string;
  format: 'epub' | 'cbz' | 'pdf';
  mime_type: string;
  byte_size: number;
  language: 'en' | 'es' | null;
  created_at: string;
  access_role: ClassroomRole | 'teacher' | null;
}

export interface ClassBookUpload {
  classroomId: string;
  file: File;
  title: string;
  author?: string;
  language?: 'en' | 'es';
}

export interface StudentStats {
  totalWords: number;
  wordsLearned: number;
  wordsDue: number;
  wordsNew: number;
  wordsInLearning: number;
  wordsMastered: number;
  daysActiveThisWeek: number;
  totalReviews: number;
  accuracy: number | null;
  lastReviewedAt: string | null;
  reviewHistoryPartial: boolean;
  reviewHistoryAccurateFrom: string | null;
  streak: number;
}

export interface DailyWord {
  action: 'reviewed' | 'added';
  word: string;
  translation: string;
}

export interface DailyActivity {
  day: string;
  reviews: number;
  wordsAdded: number;
  practiceSessions: number;
  practiceCorrect: number;
  practiceTotal: number;
  drills: number;
  voiceSessions: number;
  words: DailyWord[];
}

export interface StudentWord {
  id: string;
  word: string;
  translation: string;
  part_of_speech: string | null;
  srs_stage: 'new' | 'learning' | 'review' | 'mastered';
}

export interface StudentWordList {
  id: string;
  title: string;
  word_count: number;
  completed: boolean;
  completed_at: string | null;
}

export interface RecentSession {
  type: 'flashcards' | 'vocabulary' | 'drill' | 'voice';
  id: string;
  questionCount: number;
  correctCount: number;
  durationSeconds: number | null;
  detail: string | null;
  doneAt: string;
}

export interface StudentDetail {
  student: { id: string; username: string; display_name: string; created_at: string };
  stats: StudentStats;
  activity: DailyActivity[];
  recentSessions: RecentSession[];
  wordLists: StudentWordList[];
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

export function joinClassroom(classCode: string) {
  return request<{ classroom: Classroom; joined: boolean }>('/classrooms/join', {
    method: 'POST',
    body: { classCode },
  });
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

export function getClassBooks() {
  return request<ClassBook[]>('/class-books');
}

export function getClassroomBooks(classroomId: string) {
  return request<ClassBook[]>(`/classrooms/${classroomId}/books`);
}

export function uploadClassroomBook(
  upload: ClassBookUpload,
  onProgress?: (fraction: number) => void,
): Promise<ClassBook> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/classrooms/${encodeURIComponent(upload.classroomId)}/books`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Correlation-ID', globalThis.crypto?.randomUUID?.() || `web-${Date.now()}`);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      let payload: unknown = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch (error) {
        emitFallbackDiagnostic({
          code: 'class_book_upload_error_payload_invalid',
          severity: 'warning',
          title: 'Upload error details were unreadable',
          message: 'The class file upload failed and the server response was malformed, so Polycast is showing the HTTP status instead.',
          detail: `status=${xhr.status}; ${error instanceof Error ? error.message : String(error)}`,
        }, { source: 'web.api.classroom', operation: 'parse-class-book-upload-error' });
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload) {
        onProgress?.(1);
        resolve(payload as ClassBook);
        return;
      }
      const message = payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Book upload failed (${xhr.status || 'network error'})`;
      reject(new Error(message));
    });
    xhr.addEventListener('error', () => reject(new Error('The class book upload lost its network connection.')));
    xhr.addEventListener('abort', () => reject(new Error('The class book upload was cancelled.')));

    const body = new FormData();
    body.append('book', upload.file);
    body.append('title', upload.title);
    body.append('author', upload.author || '');
    body.append('language', upload.language || '');
    xhr.send(body);
  });
}

export function deleteClassroomBook(bookId: string) {
  return request<void>(`/class-books/${bookId}`, { method: 'DELETE' });
}

export async function downloadClassroomBook(
  book: ClassBook,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const response = await fetch(`/api/class-books/${encodeURIComponent(book.id)}/file`, {
    credentials: 'include',
    headers: { 'X-Correlation-ID': globalThis.crypto?.randomUUID?.() || `web-${Date.now()}` },
  });
  if (!response.ok) {
    let message = `Could not download ${book.title} (${response.status})`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload.error) message = payload.error;
    } catch (error) {
      emitFallbackDiagnostic({
        code: 'class_book_download_error_payload_invalid',
        severity: 'warning',
        title: 'Download error details were unreadable',
        message: 'The class file download failed and the server response was malformed, so Polycast is showing the HTTP status instead.',
        detail: `status=${response.status}; ${error instanceof Error ? error.message : String(error)}`,
      }, { source: 'web.api.classroom', operation: 'parse-class-book-download-error' });
    }
    throw new Error(message);
  }

  const total = Number(response.headers.get('Content-Length')) || book.byte_size;
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    if (total > 0) onProgress?.(Math.min(loaded / total, 1));
  }
  onProgress?.(1);
  return new Blob(chunks as BlobPart[], { type: book.mime_type });
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
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return request<StudentDetail>(withClassroomQuery(
    `/classroom/students/${studentId}/stats?timeZone=${encodeURIComponent(timeZone)}`,
    requireClassroomId(classroomId),
  ));
}
