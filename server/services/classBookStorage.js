import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

export const MAX_CLASS_BOOK_BYTES = Number.parseInt(
  process.env.CLASS_BOOK_MAX_BYTES || String(DEFAULT_MAX_BYTES),
  10,
);

export function classBookStorageRoot() {
  const configured = process.env.CLASS_BOOK_STORAGE_DIR;
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === 'production') return '/var/data/class-books';
  return path.resolve('.local-data/class-books');
}

export async function ensureClassBookStorage() {
  const root = classBookStorageRoot();
  const temporary = path.join(root, '.uploads');
  await fs.mkdir(temporary, { recursive: true });
  return { root, temporary };
}

export function createTemporaryUploadName() {
  return `${crypto.randomUUID()}.upload`;
}

export function createStorageKey(bookId, format) {
  return `${bookId}.${format}`;
}

export function storedBookPath(storageKey) {
  if (path.basename(storageKey) !== storageKey || !/^[a-f0-9-]+\.(?:epub|cbz|pdf)$/i.test(storageKey)) {
    throw new Error('Invalid book storage key');
  }
  return path.join(classBookStorageRoot(), storageKey);
}

export async function promoteClassBookUpload(temporaryPath, storageKey) {
  await ensureClassBookStorage();
  const destination = storedBookPath(storageKey);
  await fs.rename(temporaryPath, destination);
  return destination;
}

export async function removeStoredClassBook(storageKey, { ignoreMissing = false } = {}) {
  try {
    await fs.unlink(storedBookPath(storageKey));
  } catch (error) {
    if (ignoreMissing && error?.code === 'ENOENT') return;
    throw error;
  }
}

export async function removeTemporaryClassBook(temporaryPath) {
  if (!temporaryPath) return;
  try {
    await fs.unlink(temporaryPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function isZipArchive(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const signature = Buffer.alloc(4);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    if (bytesRead < 4) return false;
    return signature[0] === 0x50 && signature[1] === 0x4b && (
      (signature[2] === 0x03 && signature[3] === 0x04) ||
      (signature[2] === 0x05 && signature[3] === 0x06) ||
      (signature[2] === 0x07 && signature[3] === 0x08)
    );
  } finally {
    await handle.close();
  }
}

export async function isPdfDocument(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const signature = Buffer.alloc(5);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    return bytesRead === 5 && signature.toString('ascii') === '%PDF-';
  } finally {
    await handle.close();
  }
}
