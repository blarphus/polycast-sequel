import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseCbzPrototype, prepareCbzForOcr } from '../utils/cbz';
import { ocrPageToLines, shouldResumeComicOcr } from '../utils/comicOcr';

describe('CBZ prototype importer', () => {
  const streamedFile = (archive: Uint8Array, name: string) => {
    const file = new File([archive as BlobPart], name, { type: 'application/zip' });
    Object.defineProperty(file, 'stream', {
      value: () => new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(archive);
          controller.close();
        },
      }),
    });
    return file;
  };

  it('streams and keeps only the two mapped speech pages', async () => {
    const archive = zipSync({
      'Supergirl - Woman of Tomorrow (2021-)-008.jpg': strToU8('not selected'),
      'Supergirl - Woman of Tomorrow (2021-)-009.jpg': strToU8('speech page one'),
      'Supergirl - Woman of Tomorrow (2021-)-010.jpg': strToU8('narration only'),
      'Supergirl - Woman of Tomorrow (2021-)-011.jpg': strToU8('speech page two'),
      'Supergirl - Woman of Tomorrow (2021-)-012.jpg': strToU8('not reached'),
    });
    const file = streamedFile(archive, 'Supergirl - Woman of Tomorrow.cbz');

    const comic = await parseCbzPrototype(file);

    expect(comic.pages).toHaveLength(2);
    expect(new TextDecoder().decode(comic.pages[0].image)).toBe('speech page one');
    expect(new TextDecoder().decode(comic.pages[1].image)).toBe('speech page two');
    expect(comic.pages[0].lines.length).toBeGreaterThan(40);
    expect(comic.pages[1].lines.length).toBeGreaterThan(50);
    expect(comic.prototypeNotice).toContain('only the first two pages');
  });

  it('reports the prototype mismatch visibly instead of silently opening another CBZ', async () => {
    const archive = zipSync({ 'different-comic-001.jpg': strToU8('page') });
    const file = streamedFile(archive, 'different.cbz');

    await expect(parseCbzPrototype(file)).rejects.toThrow('[cbz_prototype_mismatch]');
  });
});

describe('full CBZ OCR importer', () => {
  it('resumes only incomplete OCR work and never requeues a completed comic', () => {
    const progress = {
      status: 'processing' as const,
      processedPages: 201,
      totalPages: 224,
      currentPage: 202,
      pageProgress: 0,
      overallProgress: 201 / 224,
      stage: 'Opening page 202 of 224',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      estimatedSecondsRemaining: 60,
      diagnosticCode: null,
      diagnosticMessage: null,
      diagnosticDetail: null,
    };

    expect(shouldResumeComicOcr(progress)).toBe(true);
    expect(shouldResumeComicOcr({ ...progress, processedPages: 224, currentPage: null })).toBe(false);
    expect(shouldResumeComicOcr({ ...progress, status: 'ready' })).toBe(false);
  });

  it('indexes every image page in natural reading order and queues the whole archive', async () => {
    const archive = zipSync({
      'comic-10.jpg': strToU8('ten'),
      'comic-2.png': strToU8('two'),
      'notes.txt': strToU8('not a page'),
      'comic-1.jpg': strToU8('one'),
    });
    const file = new File([archive as BlobPart], 'My_Comic.cbz', { type: 'application/zip' });

    const prepared = await prepareCbzForOcr(file, 'en');

    expect(prepared.comic.title).toBe('My Comic');
    expect(prepared.comic.pages.map((page) => page.entryName)).toEqual([
      'comic-1.jpg',
      'comic-2.png',
      'comic-10.jpg',
    ]);
    expect(prepared.comic.archive).toBe(file);
    expect(prepared.comic.ocr).toMatchObject({
      status: 'queued',
      processedPages: 0,
      totalPages: 3,
    });
    expect(await prepared.cover.text()).toBe('one');
  });

  it('keeps exact OCR word boxes and paragraph context for clickable text', () => {
    const lines = ocrPageToLines({
      blocks: [{
        paragraphs: [{
          text: 'Hello brave world.',
          lines: [{
            text: 'Hello brave world.',
            bbox: { x0: 10, y0: 20, x1: 210, y1: 50 },
            words: [
              { text: 'Hello', confidence: 96, bbox: { x0: 10, y0: 20, x1: 60, y1: 50 } },
              { text: 'brave', confidence: 91, bbox: { x0: 70, y0: 20, x1: 125, y1: 50 } },
              { text: 'world.', confidence: 94, bbox: { x0: 135, y0: 20, x1: 210, y1: 50 } },
            ],
          }],
        }],
      }],
    } as unknown as Parameters<typeof ocrPageToLines>[0]);

    expect(lines).toHaveLength(1);
    expect(lines[0].context).toBe('Hello brave world.');
    expect(lines[0].words?.[1]).toMatchObject({
      text: 'brave', x: 70, y: 20, width: 55, height: 30, confidence: 91,
    });
  });

  it('keeps a lower-confidence word when reliable neighbors identify a real text line', () => {
    const lines = ocrPageToLines({
      blocks: [{
        paragraphs: [{
          lines: [{
            bbox: { x0: 10, y0: 20, x1: 210, y1: 50 },
            words: [
              { text: 'Please', confidence: 95, bbox: { x0: 10, y0: 20, x1: 60, y1: 50 } },
              { text: 'remember', confidence: 31, bbox: { x0: 70, y0: 20, x1: 135, y1: 50 } },
              { text: 'me', confidence: 92, bbox: { x0: 145, y0: 20, x1: 175, y1: 50 } },
            ],
          }],
        }],
      }],
    } as unknown as Parameters<typeof ocrPageToLines>[0]);

    expect(lines[0].words?.map((word) => word.text)).toEqual(['Please', 'remember', 'me']);
  });

  it('still rejects an isolated low-confidence artwork guess', () => {
    const lines = ocrPageToLines({
      blocks: [{
        paragraphs: [{
          lines: [{
            bbox: { x0: 10, y0: 20, x1: 80, y1: 50 },
            words: [{ text: 'KRZZT', confidence: 31, bbox: { x0: 10, y0: 20, x1: 80, y1: 50 } }],
          }],
        }],
      }],
    } as unknown as Parameters<typeof ocrPageToLines>[0]);

    expect(lines).toEqual([]);
  });

  it('rejects OCR languages outside the currently supported English and Spanish pair', async () => {
    const archive = zipSync({ 'page-1.jpg': strToU8('page') });
    const file = new File([archive as BlobPart], 'comic.cbz', { type: 'application/zip' });
    await expect(prepareCbzForOcr(file, 'fr')).rejects.toThrow('[cbz_ocr_language_unsupported]');
  });
});
