import { request } from './core';
import { emitFallbackDiagnostic } from '../utils/fallbackDiagnostics';

export interface UserLibraryBook {
  id: string;
  title: string;
  author: string | null;
  original_filename: string;
  format: 'epub';
  mime_type: string;
  byte_size: number;
  language: 'en' | 'es' | null;
  created_at: string;
  source: 'personal';
}

export function getUserLibraryBooks() {
  return request<UserLibraryBook[]>('/library-books');
}

export function uploadUserLibraryBook(file: File, metadata: {
  title: string; author?: string; language?: 'en' | 'es';
}, onProgress?: (fraction: number) => void): Promise<UserLibraryBook> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/library-books');
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Correlation-ID', globalThis.crypto?.randomUUID?.() || `web-${Date.now()}`);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      let payload: unknown;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch (error) {
        payload = null;
        emitFallbackDiagnostic({
          code: 'library_book_upload_error_payload_invalid',
          severity: 'warning',
          title: 'Upload error details were unreadable',
          message: 'The profile book upload failed and its server response was malformed, so Polycast is showing the HTTP status instead.',
          detail: `status=${xhr.status}; ${error instanceof Error ? error.message : String(error)}`,
        }, { source: 'web.api.library', operation: 'parse-profile-book-upload-error' });
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload) {
        onProgress?.(1);
        resolve(payload as UserLibraryBook);
        return;
      }
      const message = payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Book upload failed (${xhr.status || 'network error'})`;
      reject(new Error(message));
    });
    xhr.addEventListener('error', () => reject(new Error('The book upload lost its network connection.')));
    const body = new FormData();
    body.append('book', file);
    body.append('title', metadata.title);
    body.append('author', metadata.author || '');
    body.append('language', metadata.language || '');
    xhr.send(body);
  });
}

export function deleteUserLibraryBook(bookId: string) {
  return request<void>(`/library-books/${bookId}`, { method: 'DELETE' });
}

async function download(path: string): Promise<Uint8Array> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'X-Correlation-ID': globalThis.crypto?.randomUUID?.() || `web-${Date.now()}` },
  });
  if (!response.ok) throw new Error(`Could not download book (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export function downloadUserLibraryBook(bookId: string) {
  return download(`/library-books/${encodeURIComponent(bookId)}/file`);
}

export function downloadSharedClassBook(bookId: string) {
  return download(`/class-books/${encodeURIComponent(bookId)}/file`);
}

export interface ServerBookProgress { chapter_index: number; page_index: number }

export function getServerBookProgress(bookId: string, source: 'personal' | 'class') {
  return request<ServerBookProgress | null>(`/library-books/${bookId}/progress?source=${source}`);
}

export function setServerBookProgress(bookId: string, source: 'personal' | 'class', chapterIndex: number, pageIndex: number) {
  return request<ServerBookProgress>(`/library-books/${bookId}/progress`, {
    method: 'PUT', body: { source, chapterIndex, pageIndex },
  });
}
