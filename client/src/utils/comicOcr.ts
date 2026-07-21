import { createWorker, OEM, PSM, type LoggerMessage, type Page, type Worker as TesseractWorker } from 'tesseract.js';
import { createScopedRuntimeLogger } from './scopedRuntimeLogger';
import { getStoredBook, listBooks, putComicPageResult, updateBookMeta, type ComicPageRecord } from './bookStore';
import { openComicArchive, type ComicDocument, type ComicOcrProgress } from './cbz';
import type { ComicTextLine } from './comicPrototypeManifest';

const runtimeLog = createScopedRuntimeLogger('web.comic.ocr');

export const COMIC_OCR_PROGRESS_EVENT = 'polycast:comic-ocr-progress';

export interface ComicOcrProgressEvent {
  bookId: string;
  progress: ComicOcrProgress;
}

const queuedIds: string[] = [];
const queuedSet = new Set<string>();
const cancelledIds = new Set<string>();
let draining = false;
let activeWorker: TesseractWorker | null = null;
let activeBookId: string | null = null;
let activeProgressLogger: ((message: LoggerMessage) => void) | null = null;

function publish(bookId: string, progress: ComicOcrProgress) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ComicOcrProgressEvent>(COMIC_OCR_PROGRESS_EVENT, {
      detail: { bookId, progress },
    }));
  }
}

function boundedProgress(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function estimatedSeconds(progress: ComicOcrProgress, now = Date.now()) {
  if (!progress.startedAt) return null;
  const completed = progress.processedPages + progress.pageProgress;
  if (completed <= 0) return null;
  const pagesPerSecond = completed / Math.max(1, (now - progress.startedAt) / 1000);
  if (pagesPerSecond <= 0) return null;
  return Math.max(0, Math.round((progress.totalPages - completed) / pagesPerSecond));
}

function liveProgress(base: ComicOcrProgress, pageIndex: number, pageProgress: number, stage: string): ComicOcrProgress {
  const now = Date.now();
  const progress = {
    ...base,
    status: 'processing' as const,
    currentPage: pageIndex + 1,
    pageProgress: boundedProgress(pageProgress),
    overallProgress: boundedProgress((base.processedPages + boundedProgress(pageProgress)) / base.totalPages),
    stage,
    updatedAt: now,
  };
  return { ...progress, estimatedSecondsRemaining: estimatedSeconds(progress, now) };
}

export function ocrPageToLines(page: Page): ComicTextLine[] {
  const lines: ComicTextLine[] = [];
  for (const block of page.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      const preparedLines = (paragraph.lines || []).map((sourceLine) => {
        const lineContainsLetters = sourceLine.words.some((word) => /\p{L}/u.test(word.text));
        const normalizedWords = (sourceLine.words || [])
          .map((word) => {
            let text = word.text.trim();
            if (text === '1' && lineContainsLetters) text = 'I';
            text = text.replace(/^[^\p{L}\p{N}'’¿¡]+|[^\p{L}\p{N}'’.,!?;:¿¡\-]+$/gu, '');
            return {
              x: word.bbox.x0,
              y: word.bbox.y0,
              width: Math.max(1, word.bbox.x1 - word.bbox.x0),
              height: Math.max(1, word.bbox.y1 - word.bbox.y0),
              text,
              confidence: word.confidence,
            };
          });
        const plausibleWord = (word: typeof normalizedWords[number]) => /\p{L}/u.test(word.text)
          && (word.text.length > 1 || /^[aiyo]$/iu.test(word.text));
        const strongWordCount = normalizedWords.filter((word) => word.confidence >= 45 && plausibleWord(word)).length;
        // Comic lettering often gives one word in an otherwise reliable line a
        // lower score because it touches a bubble edge or uses a stylized font.
        // Keep those contextual words, but retain the stricter threshold for
        // isolated guesses so artwork does not become a field of false buttons.
        const minimumConfidence = strongWordCount >= 2 ? 25 : 45;
        const words = normalizedWords.filter((word) => word.confidence >= minimumConfidence && plausibleWord(word));
        if (!words.length) return null;
        return { sourceLine, words, text: words.map((word) => word.text).join(' ') };
      }).filter((line): line is NonNullable<typeof line> => !!line);
      const context = preparedLines.map((line) => line.text).join(' ').trim();
      for (const prepared of preparedLines) {
        const { sourceLine, words, text } = prepared;
        const bbox = sourceLine.bbox;
        lines.push({
          x: bbox.x0,
          y: bbox.y0,
          width: Math.max(1, bbox.x1 - bbox.x0),
          height: Math.max(1, bbox.y1 - bbox.y0),
          text,
          context: context || text,
          words,
        });
      }
    }
  }
  return lines;
}

async function imageDimensions(blob: Blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch (error) {
    throw new Error(`[cbz_image_decode_failed] The comic page could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function createOcrWorker(language: string) {
  const trainedLanguage = language === 'es' ? 'spa' : 'eng';
  const worker = await createWorker(trainedLanguage, OEM.LSTM_ONLY, {
    logger: (message) => activeProgressLogger?.(message),
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: '1',
  });
  return worker;
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/^\[([^\]]+)\]/)?.[1] || 'cbz_ocr_failed';
}

async function persistProgress(bookId: string, progress: ComicOcrProgress) {
  await updateBookMeta(bookId, { ocr: progress });
  publish(bookId, progress);
}

async function processComic(bookId: string) {
  const stored = await getStoredBook(bookId);
  if (!stored || stored.format !== 'comic') throw new Error('[cbz_ocr_book_missing] The queued comic no longer exists.');
  const comic: ComicDocument = stored.comic;
  if (comic.kind !== 'ocr' || !comic.archive || !comic.ocr) return;

  const priorMeta = (await listBooks()).find((book) => book.id === bookId)?.ocr;
  if (priorMeta?.status === 'ready') return;
  const now = Date.now();
  let progress: ComicOcrProgress = {
    ...(priorMeta || comic.ocr),
    status: 'processing',
    currentPage: Math.min((priorMeta || comic.ocr).processedPages + 1, comic.pages.length),
    pageProgress: 0,
    overallProgress: (priorMeta || comic.ocr).processedPages / comic.pages.length,
    stage: 'Loading OCR language model',
    startedAt: (priorMeta || comic.ocr).startedAt || now,
    updatedAt: now,
    diagnosticCode: null,
    diagnosticMessage: null,
    diagnosticDetail: null,
  };
  await persistProgress(bookId, progress);

  const archive = await openComicArchive(comic.archive);
  try {
    let lastLoggerUpdate = 0;
    let lastLoggerStatus = '';
    activeProgressLogger = (message) => {
      const loggerNow = Date.now();
      const statusChanged = message.status !== lastLoggerStatus;
      if (!statusChanged && message.progress < 1 && loggerNow - lastLoggerUpdate < 120) return;
      lastLoggerUpdate = loggerNow;
      lastLoggerStatus = message.status;
      const pageIndex = Math.min(progress.processedPages, comic.pages.length - 1);
      const recognizing = message.status.toLowerCase().includes('recognizing');
      const next = liveProgress(
        progress,
        pageIndex,
        recognizing ? message.progress : 0,
        recognizing
          ? `Selecting text on page ${pageIndex + 1} of ${comic.pages.length}`
          : `${message.status} · page ${pageIndex + 1} of ${comic.pages.length}`,
      );
      publish(bookId, next);
    };
    activeWorker = await createOcrWorker(comic.language);

    for (let pageIndex = progress.processedPages; pageIndex < comic.pages.length; pageIndex += 1) {
      if (cancelledIds.has(bookId)) return;
      const page = comic.pages[pageIndex];
      progress = liveProgress(progress, pageIndex, 0, `Opening page ${pageIndex + 1} of ${comic.pages.length}`);
      await persistProgress(bookId, progress);

      const image = await archive.getPageBlob(page.entryName);
      const dimensions = await imageDimensions(image);
      const result = await activeWorker.recognize(image, {}, { blocks: true });
      const lines = ocrPageToLines(result.data);
      const record: ComicPageRecord = {
        id: `${bookId}:${pageIndex}`,
        bookId,
        pageIndex,
        entryName: page.entryName,
        width: dimensions.width,
        height: dimensions.height,
        lines,
        recognizedText: result.data.text.trim(),
        meanConfidence: Number.isFinite(result.data.confidence) ? result.data.confidence : null,
        completedAt: Date.now(),
      };
      await putComicPageResult(record);

      const completed = pageIndex + 1;
      const completedAt = Date.now();
      progress = {
        ...progress,
        status: completed === comic.pages.length ? 'ready' : 'processing',
        processedPages: completed,
        currentPage: completed === comic.pages.length ? null : completed + 1,
        pageProgress: 0,
        overallProgress: completed / comic.pages.length,
        stage: completed === comic.pages.length
          ? `Text selection complete · ${comic.pages.length} pages ready`
          : `Page ${completed} complete · ${lines.reduce((sum, line) => sum + (line.words?.length || 0), 0)} words selected`,
        updatedAt: completedAt,
        estimatedSecondsRemaining: null,
      };
      progress.estimatedSecondsRemaining = estimatedSeconds(progress, completedAt);
      await persistProgress(bookId, progress);
    }
  } finally {
    activeProgressLogger = null;
    if (activeWorker) {
      try {
        await activeWorker.terminate();
      } catch (error) {
        runtimeLog.error('[cbz_ocr_worker_terminate_failed] OCR worker cleanup failed:', error);
      }
    }
    activeWorker = null;
    try {
      await archive.close();
    } catch (error) {
      runtimeLog.error('[cbz_ocr_archive_close_failed] Comic archive cleanup failed:', error);
    }
  }
}

async function markFailed(bookId: string, error: unknown) {
  const meta = (await listBooks()).find((book) => book.id === bookId);
  if (!meta?.ocr) return;
  const message = error instanceof Error ? error.message : String(error);
  const code = errorCode(error);
  const progress: ComicOcrProgress = {
    ...meta.ocr,
    status: 'error',
    currentPage: null,
    pageProgress: 0,
    stage: 'OCR stopped with a visible error',
    updatedAt: Date.now(),
    estimatedSecondsRemaining: null,
    diagnosticCode: code,
    diagnosticMessage: 'Polycast could not finish selecting text from this CBZ.',
    diagnosticDetail: message,
  };
  runtimeLog.error(`[${code}] CBZ OCR failed for ${bookId}`, error);
  await persistProgress(bookId, progress);
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    while (queuedIds.length) {
      const bookId = queuedIds.shift()!;
      queuedSet.delete(bookId);
      if (cancelledIds.delete(bookId)) continue;
      try {
        activeBookId = bookId;
        await processComic(bookId);
      } catch (error) {
        await markFailed(bookId, error);
      } finally {
        activeBookId = null;
      }
    }
  } finally {
    draining = false;
  }
}

export function startComicOcr(bookId: string) {
  if (queuedSet.has(bookId) || activeBookId === bookId) return;
  queuedSet.add(bookId);
  queuedIds.push(bookId);
  void drainQueue();
}

export async function retryComicOcr(bookId: string) {
  const meta = (await listBooks()).find((book) => book.id === bookId);
  if (!meta?.ocr) throw new Error('[cbz_ocr_metadata_missing] OCR progress metadata is unavailable.');
  const progress: ComicOcrProgress = {
    ...meta.ocr,
    status: 'queued',
    currentPage: null,
    pageProgress: 0,
    overallProgress: meta.ocr.processedPages / Math.max(1, meta.ocr.totalPages),
    stage: `Queued to resume at page ${meta.ocr.processedPages + 1}`,
    updatedAt: Date.now(),
    diagnosticCode: null,
    diagnosticMessage: null,
    diagnosticDetail: null,
  };
  await persistProgress(bookId, progress);
  startComicOcr(bookId);
}

export function cancelComicOcr(bookId: string) {
  cancelledIds.add(bookId);
  const queueIndex = queuedIds.indexOf(bookId);
  if (queueIndex >= 0) queuedIds.splice(queueIndex, 1);
  queuedSet.delete(bookId);
  if (activeBookId === bookId && activeWorker) {
    void activeWorker.terminate().catch((error) => {
      runtimeLog.error('[cbz_ocr_cancel_failed] OCR cancellation cleanup failed:', error);
    });
  }
}

export async function resumePendingComicOcr() {
  const books = await listBooks();
  for (const book of books) {
    if (book.format === 'comic' && (book.ocr?.status === 'queued' || book.ocr?.status === 'processing')) {
      startComicOcr(book.id);
    }
  }
}
