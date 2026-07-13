import { Unzip, UnzipInflate } from 'fflate';
import { emitFallbackDiagnostic } from './fallbackDiagnostics';
import { SUPERGIRL_CBZ_PROTOTYPE, type ComicTextLine } from './comicPrototypeManifest';

export interface ComicPage {
  entryName: string;
  image: Uint8Array;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  lines: ComicTextLine[];
}

export interface ComicDocument {
  title: string;
  author: string;
  language: string;
  prototypeNotice: string;
  pages: ComicPage[];
}

const PROTOTYPE_NOTICE = 'CBZ preview: only the first two pages containing speech bubbles are available in this build.';

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

  const reader = file.stream().getReader();
  try {
    while (extracted.size < SUPERGIRL_CBZ_PROTOTYPE.pages.length) {
      const { value, done } = await reader.read();
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
    if (extracted.size === SUPERGIRL_CBZ_PROTOTYPE.pages.length) await reader.cancel();
    reader.releaseLock();
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
