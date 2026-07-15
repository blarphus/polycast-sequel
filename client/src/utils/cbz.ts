import { BlobReader, BlobWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { Unzip, UnzipInflate } from 'fflate';
import { emitFallbackDiagnostic } from './fallbackDiagnostics';
import { SUPERGIRL_CBZ_PROTOTYPE, type ComicTextLine } from './comicPrototypeManifest';

export type ComicOcrStatus = 'queued' | 'processing' | 'ready' | 'error';

export interface ComicOcrProgress {
  status: ComicOcrStatus;
  processedPages: number;
  totalPages: number;
  currentPage: number | null;
  pageProgress: number;
  overallProgress: number;
  stage: string;
  startedAt: number | null;
  updatedAt: number;
  estimatedSecondsRemaining: number | null;
  diagnosticCode: string | null;
  diagnosticMessage: string | null;
  diagnosticDetail: string | null;
}

export interface ComicPage {
  entryName: string;
  image?: Uint8Array;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  lines: ComicTextLine[];
}

export interface ComicDocument {
  version?: 1 | 2;
  kind?: 'prototype' | 'ocr';
  title: string;
  author: string;
  language: string;
  prototypeNotice?: string;
  sourceFileName?: string;
  archive?: Blob;
  ocr?: ComicOcrProgress;
  pages: ComicPage[];
}

export interface PreparedComicImport {
  comic: ComicDocument;
  cover: Blob;
}

export interface ComicArchiveSession {
  getPageBlob(entryName: string): Promise<Blob>;
  close(): Promise<void>;
}

const PROTOTYPE_NOTICE = 'CBZ preview: only the first two pages containing speech bubbles are available in this build.';
const IMAGE_ENTRY = /\.(?:jpe?g|png|webp)$/i;
const pageNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function imageMime(entryName: string): ComicPage['mimeType'] {
  const lower = entryName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function visibleImageEntries(entries: Awaited<ReturnType<ZipReader<Blob>['getEntries']>>): FileEntry[] {
  return entries
    .filter((entry): entry is FileEntry => !entry.directory && IMAGE_ENTRY.test(entry.filename) && !entry.filename.includes('__MACOSX/'))
    .sort((a, b) => pageNameCollator.compare(a.filename, b.filename));
}

function titleFromFileName(name: string) {
  return name.replace(/\.cbz$/i, '').replace(/_/g, ' ').trim() || 'Untitled comic';
}

export async function prepareCbzForOcr(file: File, language: string): Promise<PreparedComicImport> {
  if (!file.name.toLowerCase().endsWith('.cbz')) {
    throw new Error('[cbz_invalid_extension] Choose a .cbz comic archive.');
  }
  if (language !== 'en' && language !== 'es') {
    throw new Error(`[cbz_ocr_language_unsupported] CBZ OCR currently supports English and Spanish. Current target language: ${language || 'unset'}.`);
  }

  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = visibleImageEntries(await reader.getEntries());
    if (!entries.length) {
      throw new Error('[cbz_no_image_pages] This CBZ does not contain supported JPEG, PNG, or WebP pages.');
    }
    if (entries.length > 2_000) {
      throw new Error(`[cbz_page_limit_exceeded] This archive contains ${entries.length} image pages; the safety limit is 2,000.`);
    }

    const coverEntry = entries[0];
    const cover = await coverEntry.getData(new BlobWriter(imageMime(coverEntry.filename)));
    const now = Date.now();
    return {
      cover,
      comic: {
        version: 2,
        kind: 'ocr',
        title: titleFromFileName(file.name),
        author: 'Unknown author',
        language,
        sourceFileName: file.name,
        archive: file,
        pages: entries.map((entry) => ({
          entryName: entry.filename,
          mimeType: imageMime(entry.filename),
          width: 0,
          height: 0,
          lines: [],
        })),
        ocr: {
          status: 'queued',
          processedPages: 0,
          totalPages: entries.length,
          currentPage: null,
          pageProgress: 0,
          overallProgress: 0,
          stage: 'Queued for on-device text selection',
          startedAt: null,
          updatedAt: now,
          estimatedSecondsRemaining: null,
          diagnosticCode: null,
          diagnosticMessage: null,
          diagnosticDetail: null,
        },
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[cbz_')) throw error;
    throw new Error(`[cbz_archive_read_failed] Could not read the CBZ archive: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try {
      await reader.close();
    } catch (error) {
      throw new Error(`[cbz_archive_close_failed] Could not close the uploaded CBZ cleanly: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function openComicArchive(archive: Blob): Promise<ComicArchiveSession> {
  const reader = new ZipReader(new BlobReader(archive));
  let entryMap: Map<string, FileEntry>;
  try {
    entryMap = new Map(visibleImageEntries(await reader.getEntries()).map((entry) => [entry.filename, entry]));
  } catch (error) {
    try {
      await reader.close();
    } catch (closeError) {
      throw new Error(`[cbz_archive_close_failed] Comic indexing failed and the archive could not close cleanly: ${closeError instanceof Error ? closeError.message : String(closeError)}. Initial error: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw new Error(`[cbz_archive_open_failed] Could not index comic pages: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    async getPageBlob(entryName: string) {
      const entry = entryMap.get(entryName);
      if (!entry) throw new Error(`[cbz_page_missing] The archive no longer contains “${entryName}”.`);
      try {
        return await entry.getData(new BlobWriter(imageMime(entryName)));
      } catch (error) {
        throw new Error(`[cbz_page_extract_failed] Could not extract “${entryName}”: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    close: () => reader.close(),
  };
}

function joinChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function matchingDefinition(entryName: string) {
  const lower = entryName.toLowerCase();
  return SUPERGIRL_CBZ_PROTOTYPE.pages.find((page) => lower.endsWith(page.entrySuffix));
}

/** Kept for existing two-page IndexedDB records and its deterministic fixture tests. */
export async function parseCbzPrototype(file: File): Promise<ComicDocument> {
  if (!file.name.toLowerCase().endsWith('.cbz')) {
    throw new Error('[cbz_invalid_extension] Choose a .cbz comic archive.');
  }

  const extracted = new Map<string, Uint8Array>();
  let extractionError: Error | null = null;
  const unzip = new Unzip((entry) => {
    const definition = matchingDefinition(entry.name);
    if (!definition || extracted.has(definition.entrySuffix)) return;

    const chunks: Uint8Array[] = [];
    let size = 0;
    entry.ondata = (error, data, final) => {
      if (error) {
        extractionError = error;
        return;
      }
      chunks.push(data);
      size += data.length;
      if (final) extracted.set(definition.entrySuffix, joinChunks(chunks, size));
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  const streamReader = file.stream().getReader();
  try {
    while (extracted.size < SUPERGIRL_CBZ_PROTOTYPE.pages.length) {
      const { value, done } = await streamReader.read();
      if (done) {
        unzip.push(new Uint8Array(), true);
        break;
      }
      unzip.push(value, false);
      if (extractionError) throw extractionError;
    }
  } catch (error) {
    throw new Error(`[cbz_stream_failed] Could not read the comic archive: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (extracted.size === SUPERGIRL_CBZ_PROTOTYPE.pages.length) await streamReader.cancel();
    streamReader.releaseLock();
  }

  const missing = SUPERGIRL_CBZ_PROTOTYPE.pages.filter((page) => !extracted.has(page.entrySuffix));
  if (missing.length) {
    throw new Error(`[cbz_prototype_mismatch] This prototype currently supports the Supergirl archive on your Desktop. Missing ${missing.map((page) => page.entrySuffix).join(', ')}.`);
  }

  emitFallbackDiagnostic({
    code: 'cbz_two_page_prototype',
    severity: 'warning',
    title: 'Two-page CBZ preview imported',
    message: PROTOTYPE_NOTICE,
    detail: `source=${file.name} · extracted=${SUPERGIRL_CBZ_PROTOTYPE.pages.map((page) => page.entrySuffix).join(',')}`,
  }, { source: 'web.cbz', operation: 'import-prototype' });

  return {
    version: 1,
    kind: 'prototype',
    title: SUPERGIRL_CBZ_PROTOTYPE.title,
    author: SUPERGIRL_CBZ_PROTOTYPE.author,
    language: SUPERGIRL_CBZ_PROTOTYPE.language,
    prototypeNotice: PROTOTYPE_NOTICE,
    pages: SUPERGIRL_CBZ_PROTOTYPE.pages.map((definition) => ({
      entryName: definition.entrySuffix,
      image: extracted.get(definition.entrySuffix)!,
      mimeType: 'image/jpeg',
      width: definition.width,
      height: definition.height,
      lines: definition.lines,
    })),
  };
}
