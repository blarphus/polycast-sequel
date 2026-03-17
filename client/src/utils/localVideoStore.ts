// ---------------------------------------------------------------------------
// utils/localVideoStore.ts — Module-level store for local video/SRT files
// with IndexedDB persistence, progress tracking, and thumbnail generation
// ---------------------------------------------------------------------------

export interface LocalVideoEntry {
  videoFile: File;
  srtFile: File | null;
  name: string;
}

// ---- In-memory store ----

let entries: LocalVideoEntry[] = [];

export function setLocalVideos(videos: LocalVideoEntry[]) {
  entries = videos;
}

export function getLocalVideos(): LocalVideoEntry[] {
  return entries;
}

export function getLocalVideo(name: string): LocalVideoEntry | undefined {
  return entries.find((e) => e.name === name);
}

// ---- IndexedDB: persist directory handle across refreshes ----

const DB_NAME = 'polycast-local';
const STORE_NAME = 'dir-handle';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(handle, 'lastDir');
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function loadDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('lastDir');
    return new Promise((resolve, reject) => {
      req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    return null;
  }
}

// ---- File enumeration from directory handle ----

const VIDEO_EXTENSIONS = new Set(['mp4', 'avi', 'mkv', 'webm', 'mov', 'ogv']);

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function getBaseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(0, dot) : name;
}

export async function loadFromDirHandle(
  handle: FileSystemDirectoryHandle,
): Promise<LocalVideoEntry[]> {
  // queryPermission / requestPermission are not fully typed in all TS versions
  const h = handle as any;
  let permission = await h.queryPermission({ mode: 'read' });
  if (permission !== 'granted') {
    permission = await h.requestPermission({ mode: 'read' });
  }
  if (permission !== 'granted') return [];

  const files: File[] = [];
  // @ts-expect-error — handle.values() async iterator not fully typed in all TS versions
  for await (const entry of handle.values()) {
    if (entry.kind === 'file') {
      files.push(await entry.getFile());
    }
  }

  const videoFiles = files.filter((f) => VIDEO_EXTENSIONS.has(getExtension(f.name)));
  const srtFiles = new Map<string, File>();
  for (const f of files) {
    if (getExtension(f.name) === 'srt') {
      srtFiles.set(getBaseName(f.name).toLowerCase(), f);
    }
  }

  const result: LocalVideoEntry[] = videoFiles
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((videoFile) => ({
      videoFile,
      srtFile: srtFiles.get(getBaseName(videoFile.name).toLowerCase()) ?? null,
      name: videoFile.name,
    }));

  setLocalVideos(result);
  return result;
}

// ---- Progress tracking (localStorage) ----

const PROGRESS_KEY = 'polycast-local-progress';

export interface VideoProgress {
  currentTime: number;
  duration: number;
  completed: boolean;
}

export function getVideoProgress(name: string): VideoProgress | null {
  const data = localStorage.getItem(PROGRESS_KEY);
  if (!data) return null;
  const map = JSON.parse(data);
  return map[name] ?? null;
}

export function saveVideoProgress(name: string, currentTime: number, duration: number): void {
  const data = localStorage.getItem(PROGRESS_KEY);
  const map = data ? JSON.parse(data) : {};
  const completed = map[name]?.completed || (duration > 0 && currentTime / duration >= 0.9);
  map[name] = { currentTime, duration, completed };
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
}

export function getAllProgress(): Record<string, VideoProgress> {
  const data = localStorage.getItem(PROGRESS_KEY);
  return data ? JSON.parse(data) : {};
}

// ---- Thumbnail generation ----

export function generateThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    video.onloadeddata = () => {
      video.currentTime = Math.min(2, video.duration * 0.1);
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, 160, 90);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      URL.revokeObjectURL(url);
      resolve(dataUrl);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to generate thumbnail'));
    };
  });
}
