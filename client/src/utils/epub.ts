// ---------------------------------------------------------------------------
// utils/epub.ts -- Client-side EPUB parser.
//
// Unzips an .epub (fflate), reads the OPF (manifest/spine/metadata), the TOC
// (EPUB3 nav or EPUB2 NCX), and extracts each spine chapter's text as ordered
// blocks of sentences + images. The reader renders these through the existing
// TokenizedText component so every word is clickable — no iframe.
// ---------------------------------------------------------------------------

import { unzipSync, strFromU8 } from 'fflate';
import { emitFallbackDiagnostic } from './fallbackDiagnostics';

export interface EpubBlock {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'img';
  sentences?: string[]; // for text blocks
  imgHref?: string;     // zip path, for img blocks
}

export interface EpubChapter {
  href: string;            // spine item zip path
  label: string | null;    // from TOC, if any
  blocks: EpubBlock[];
}

export interface ParsedEpub {
  title: string;
  author: string;
  language: string | null;
  coverHref: string | null;
  chapters: EpubChapter[];
  files: Record<string, Uint8Array>;
}

type SentenceSegmenter = {
  segment(input: string): Iterable<{ segment: string }>;
};

type SentenceSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'sentence' },
) => SentenceSegmenter;

// --- path helpers ----------------------------------------------------------

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

/** Resolve an href (possibly relative, with ../, #frag, %20) against a base dir to a zip key. */
function resolvePath(baseDir: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0].split('?')[0]);
  const parts = (clean.startsWith('/') ? clean : baseDir + clean).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function normalizeFilePath(path: string): string {
  return path.replace(/^\.?\//, '');
}

function normalizeFiles(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const normalized: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files)) {
    normalized[normalizeFilePath(path)] = bytes;
  }
  return normalized;
}

function findFilePath(files: Record<string, Uint8Array>, path: string): string | null {
  const normalized = normalizeFilePath(path);
  if (files[normalized]) return normalized;
  const lower = normalized.toLowerCase();
  return Object.keys(files).find((key) => key.toLowerCase() === lower) ?? null;
}

function xmlDoc(files: Record<string, Uint8Array>, path: string): Document | null {
  const filePath = findFilePath(files, path);
  const bytes = filePath ? files[filePath] : null;
  if (!bytes) return null;
  const doc = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  return doc;
}

function localTag(doc: Document | Element, name: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS('*', name));
}

// --- sentence splitting ----------------------------------------------------

function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  // Prefer Intl.Segmenter when available (handles abbreviations far better).
  const Seg = (Intl as typeof Intl & { Segmenter?: SentenceSegmenterConstructor }).Segmenter;
  if (Seg) {
    try {
      const seg = new Seg(undefined, { granularity: 'sentence' });
      const out: string[] = [];
      for (const { segment } of seg.segment(clean)) {
        const s = segment.trim();
        if (s) out.push(s);
      }
      if (out.length) return out;
    } catch (error) {
      emitFallbackDiagnostic({
        code: 'epub_sentence_segmenter_fallback',
        severity: 'warning',
        title: 'Simpler sentence splitting used',
        message: 'The browser sentence segmenter failed, so this book is using punctuation-based sentence splitting.',
        detail: error instanceof Error ? error.message : String(error),
      }, { source: 'web.epub', operation: 'split-sentences' });
    }
  }
  return clean.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
}

function normalizeLanguage(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) return null;
  const primary = trimmed.split(/[-_]/)[0];
  return primary || null;
}

function inferLanguageFromText(chapters: EpubChapter[]): string | null {
  const sample = chapters
    .flatMap((chapter) => chapter.blocks)
    .flatMap((block) => block.sentences || [])
    .join(' ')
    .toLowerCase()
    .slice(0, 8000);
  if (!sample) return null;

  const tokens = sample.match(/\p{L}+/gu) || [];
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);

  const score = (words: string[]) => words.reduce((sum, word) => sum + (counts.get(word) || 0), 0);
  const scores = [
    {
      lang: 'es',
      score: score(['el', 'la', 'los', 'las', 'que', 'una', 'pero', 'para', 'con', 'por', 'del', 'al', 'hay', 'hoy', 'puedo', 'voy', 'sin']),
    },
    {
      lang: 'pt',
      score: score(['o', 'a', 'os', 'as', 'que', 'uma', 'mas', 'para', 'com', 'por', 'não', 'dos', 'das', 'está', 'foi', 'vou']),
    },
    {
      lang: 'fr',
      score: score(['le', 'la', 'les', 'que', 'une', 'mais', 'pour', 'avec', 'des', 'est', 'pas', 'dans', 'sur']),
    },
    {
      lang: 'en',
      score: score(['the', 'and', 'that', 'you', 'with', 'for', 'not', 'this', 'have', 'will', 'from']),
    },
  ].sort((a, b) => b.score - a.score);

  return scores[0].score >= 8 && scores[0].score >= scores[1].score + 3 ? scores[0].lang : null;
}

// --- TOC --------------------------------------------------------------------

function parseToc(files: Record<string, Uint8Array>, opfDir: string, navPath: string | null, ncxPath: string | null): Map<string, string> {
  const labels = new Map<string, string>(); // zip path (no frag) -> label
  // EPUB3 nav.xhtml
  if (navPath && files[navPath]) {
    const doc = new DOMParser().parseFromString(strFromU8(files[navPath]), 'text/html');
    const navDir = dirOf(navPath);
    const anchors = doc.querySelectorAll('nav a[href]');
    anchors.forEach((a) => {
      const href = a.getAttribute('href');
      const label = a.textContent?.trim();
      if (href && label) labels.set(resolvePath(navDir, href), label);
    });
    if (labels.size) return labels;
  }
  // EPUB2 NCX
  if (ncxPath) {
    const doc = xmlDoc(files, ncxPath);
    if (doc) {
      const ncxDir = dirOf(ncxPath);
      for (const np of localTag(doc, 'navPoint')) {
        const label = localTag(np, 'text')[0]?.textContent?.trim();
        const src = localTag(np, 'content')[0]?.getAttribute('src');
        if (label && src) labels.set(resolvePath(ncxDir, src), label);
      }
    }
  }
  return labels;
}

// --- chapter extraction -----------------------------------------------------

function extractBlocks(files: Record<string, Uint8Array>, chapterPath: string): EpubBlock[] {
  const bytes = files[chapterPath];
  if (!bytes) return [];
  const doc = new DOMParser().parseFromString(strFromU8(bytes), 'text/html');
  const baseDir = dirOf(chapterPath);
  const blocks: EpubBlock[] = [];
  const nodes = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, img, image');
  nodes.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'img' || tag === 'image') {
      const src = el.getAttribute('src')
        || el.getAttribute('href')
        || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (src) blocks.push({ type: 'img', imgHref: resolvePath(baseDir, src) });
      return;
    }
    const text = el.textContent || '';
    if (!text.trim()) return;
    if (tag === 'p' || tag === 'li') {
      blocks.push({ type: 'p', sentences: splitSentences(text) });
    } else {
      const level = tag === 'h1' ? 'h1' : tag === 'h2' ? 'h2' : 'h3';
      blocks.push({ type: level, sentences: [text.replace(/\s+/g, ' ').trim()] });
    }
  });
  return blocks;
}

// --- main parse -------------------------------------------------------------

function findOpfPath(files: Record<string, Uint8Array>): string | null {
  const containerPath = findFilePath(files, 'META-INF/container.xml');
  const container = containerPath ? xmlDoc(files, containerPath) : null;
  const rootfilePath = container && localTag(container, 'rootfile')[0]?.getAttribute('full-path');
  if (rootfilePath) {
    const resolved = findFilePath(files, rootfilePath);
    if (resolved) return resolved;
  }

  const opfPaths = Object.keys(files).filter((path) => path.toLowerCase().endsWith('.opf'));
  return opfPaths.find((path) => /(^|\/)content\.opf$/i.test(path)) ?? opfPaths[0] ?? null;
}

export function parseEpub(bytes: Uint8Array): ParsedEpub {
  const files = normalizeFiles(unzipSync(bytes));

  // 1. container.xml -> OPF path
  const opfPath = findOpfPath(files);
  if (!opfPath) throw new Error('Invalid EPUB: no OPF found');

  const opf = xmlDoc(files, opfPath);
  if (!opf) throw new Error('Invalid EPUB: cannot read OPF');
  const opfDir = dirOf(opfPath);

  // 2. metadata
  const title = localTag(opf, 'title')[0]?.textContent?.trim() || 'Untitled';
  const author = localTag(opf, 'creator')[0]?.textContent?.trim() || 'Unknown author';
  let language = normalizeLanguage(localTag(opf, 'language')[0]?.textContent);

  // 3. manifest: id -> { href, properties }
  const manifest = new Map<string, { href: string; properties: string }>();
  let navPath: string | null = null;
  let coverHref: string | null = null;
  for (const item of localTag(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href) continue;
    const properties = item.getAttribute('properties') || '';
    const full = resolvePath(opfDir, href);
    manifest.set(id, { href: full, properties });
    if (properties.includes('nav')) navPath = full;
    if (properties.includes('cover-image')) coverHref = full;
  }

  // EPUB2 cover: <meta name="cover" content="ID">
  if (!coverHref) {
    const meta = localTag(opf, 'meta').find((m) => m.getAttribute('name') === 'cover');
    const coverId = meta?.getAttribute('content');
    if (coverId && manifest.has(coverId)) coverHref = manifest.get(coverId)!.href;
  }

  // 4. spine order + NCX path (toc attr)
  const spineEl = localTag(opf, 'spine')[0];
  const ncxId = spineEl?.getAttribute('toc');
  const ncxPath = ncxId && manifest.has(ncxId) ? manifest.get(ncxId)!.href : null;

  const labels = parseToc(files, opfDir, navPath, ncxPath);

  // 5. build chapters from spine
  const chapters: EpubChapter[] = [];
  for (const ref of localTag(opf, 'itemref')) {
    const idref = ref.getAttribute('idref');
    if (!idref) continue;
    const item = manifest.get(idref);
    if (!item) continue;
    const blocks = extractBlocks(files, item.href);
    if (!blocks.length) continue; // skip empty/structural pages
    chapters.push({ href: item.href, label: labels.get(item.href) ?? null, blocks });
  }

  if (!chapters.length) throw new Error('EPUB has no readable chapters');
  language ||= inferLanguageFromText(chapters);

  return { title, author, language, coverHref, chapters, files };
}

// --- image resolution -------------------------------------------------------

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp',
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/** Turn a zip-internal image path into an object URL (caller revokes). */
export function imageObjectUrl(files: Record<string, Uint8Array>, href: string): string | null {
  const bytes = files[href];
  if (!bytes) return null;
  const ext = href.split('.').pop()?.toLowerCase() || '';
  const type = MIME[ext] || 'image/jpeg';
  return URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type }));
}

/** Cover image as a Blob for storage/thumbnails, or null. */
export function coverBlob(parsed: ParsedEpub): Blob | null {
  if (!parsed.coverHref) return null;
  const bytes = parsed.files[parsed.coverHref];
  if (!bytes) return null;
  const ext = parsed.coverHref.split('.').pop()?.toLowerCase() || '';
  return new Blob([toArrayBuffer(bytes)], { type: MIME[ext] || 'image/jpeg' });
}
