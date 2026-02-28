import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_YTDLP_BINARY = path.resolve(
  __dirname,
  '..',
  'node_modules',
  'youtube-dl-exec',
  'bin',
  'yt-dlp',
);
const YTDLP_BINARY = process.env.YTDLP_BINARY || DEFAULT_YTDLP_BINARY;

export class TranscriptFetchError extends Error {
  constructor(message, code, transient = false) {
    super(message);
    this.name = 'TranscriptFetchError';
    this.code = code;
    this.transient = transient;
  }
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(text) {
  return text.replace(/<[^>]+>/g, '');
}

function parseTimestampToMs(raw) {
  const normalized = raw.replace(',', '.');
  const parts = normalized.split(':');

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 3) {
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
    seconds = Number(parts[2]);
  } else if (parts.length === 2) {
    minutes = Number(parts[0]);
    seconds = Number(parts[1]);
  } else {
    return null;
  }

  if ([hours, minutes, seconds].some((n) => Number.isNaN(n))) return null;

  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function parseVtt(vttText) {
  const lines = vttText.replace(/\r/g, '').split('\n');
  const segments = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line || line === 'WEBVTT' || line.startsWith('NOTE') || line.startsWith('STYLE')) {
      i += 1;
      continue;
    }

    const timingLine = line.includes('-->')
      ? line
      : (lines[i + 1] || '').trim().includes('-->')
        ? (lines[i + 1] || '').trim()
        : null;

    if (!timingLine) {
      i += 1;
      continue;
    }

    const match = timingLine.match(
      /^((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/,
    );
    if (!match) {
      i += 1;
      continue;
    }

    const startMs = parseTimestampToMs(match[1]);
    const endMs = parseTimestampToMs(match[2]);

    if (startMs == null || endMs == null || endMs < startMs) {
      i += 1;
      continue;
    }

    i += (timingLine === line ? 1 : 2);

    const textLines = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i].trim());
      i += 1;
    }

    const text = decodeEntities(stripTags(textLines.join(' '))).replace(/\s+/g, ' ').trim();
    if (!text) continue;

    segments.push({
      text,
      offset: startMs,
      duration: Math.max(0, endMs - startMs),
    });
  }

  return segments;
}

function classifyYtDlpFailure(stderrText) {
  const normalized = stderrText.toLowerCase();

  if (normalized.includes('captcha') ||
      normalized.includes('too many requests') ||
      normalized.includes('http error 429') ||
      normalized.includes('sign in to confirm') ||
      normalized.includes('precondition check failed') ||
      normalized.includes('failed_precondition')) {
    return new TranscriptFetchError(
      'YouTube temporarily blocked transcript requests.',
      'BLOCKED_OR_RATE_LIMITED',
      true,
    );
  }

  if (normalized.includes('no subtitles') ||
      normalized.includes('no automatic captions') ||
      normalized.includes('subtitles are disabled') ||
      normalized.includes('requested format is not available')) {
    return new TranscriptFetchError(
      'No YouTube captions available for this video/language.',
      'NO_CAPTIONS',
      false,
    );
  }

  if (normalized.includes('video unavailable') ||
      normalized.includes('private video') ||
      normalized.includes('this video is unavailable') ||
      normalized.includes('unsupported url')) {
    return new TranscriptFetchError(
      'Video is unavailable for transcript extraction.',
      'SOURCE_UNAVAILABLE',
      false,
    );
  }

  if (normalized.includes('enoent') ||
      normalized.includes('python') ||
      normalized.includes('permission denied')) {
    return new TranscriptFetchError(
      'yt-dlp is not configured correctly on the server.',
      'CONFIG_ERROR',
      false,
    );
  }

  return new TranscriptFetchError(
    'Transcript fetch temporarily failed.',
    'TRANSIENT_FETCH_ERROR',
    true,
  );
}

async function runYtDlp(url, language, outTemplate, mode) {
  const args = [
    url,
    '--skip-download',
    '--no-warnings',
    '--no-call-home',
    '--no-check-certificates',
    '--sub-format', 'vtt',
    '--sub-langs', language,
    '--output', outTemplate,
  ];

  if (mode === 'manual') {
    args.push('--write-subs');
  } else {
    args.push('--write-auto-subs');
  }

  try {
    await fs.access(YTDLP_BINARY);
  } catch {
    throw new TranscriptFetchError(
      'yt-dlp binary is not available on the server.',
      'CONFIG_ERROR',
      false,
    );
  }

  await new Promise((resolve, reject) => {
    const child = spawn(YTDLP_BINARY, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(classifyYtDlpFailure(`${stderr}\n${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(classifyYtDlpFailure(stderr));
    });
  });
}

function pickSubtitleFile(files, language) {
  const vttFiles = files.filter((f) => f.toLowerCase().endsWith('.vtt'));
  if (vttFiles.length === 0) return null;

  const lang = language.toLowerCase();
  const shortLang = lang.split('-')[0];

  const exact = vttFiles.find((f) => {
    const lf = f.toLowerCase();
    return lf.includes(`.${lang}.`) || lf.includes(`.${lang}-`);
  });
  if (exact) return exact;

  const short = vttFiles.find((f) => {
    const lf = f.toLowerCase();
    return lf.includes(`.${shortLang}.`) || lf.includes(`.${shortLang}-`);
  });
  if (short) return short;

  return vttFiles[0];
}

async function extractMode(youtubeId, language, mode, tempRoot) {
  const modeDir = path.join(tempRoot, mode);
  await fs.mkdir(modeDir, { recursive: true });

  const outTemplate = path.join(modeDir, '%(id)s.%(ext)s');
  const url = `https://www.youtube.com/watch?v=${youtubeId}`;

  try {
    await runYtDlp(url, language, outTemplate, mode);
  } catch (err) {
    if (err instanceof TranscriptFetchError && err.code === 'NO_CAPTIONS') return null;
    throw err;
  }

  const files = await fs.readdir(modeDir);
  const picked = pickSubtitleFile(files, language);
  if (!picked) return null;

  const raw = await fs.readFile(path.join(modeDir, picked), 'utf8');
  const segments = parseVtt(raw);

  if (!segments.length) {
    throw new TranscriptFetchError(
      'Caption file was present but could not be parsed.',
      'PARSER_ERROR',
      false,
    );
  }

  return segments;
}

/**
 * Fetch transcript segments from YouTube captions using yt-dlp.
 * Returns manual captions first, then auto captions fallback.
 */
export async function fetchYouTubeTranscript(youtubeId, language = 'en') {
  const normalizedLang = (language || 'en').trim().toLowerCase();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'polycast-transcript-'));

  try {
    const manual = await extractMode(youtubeId, normalizedLang, 'manual', tempRoot);
    if (manual) {
      return { segments: manual, source: 'manual' };
    }

    const auto = await extractMode(youtubeId, normalizedLang, 'auto', tempRoot);
    if (auto) {
      return { segments: auto, source: 'auto' };
    }

    throw new TranscriptFetchError(
      'No YouTube captions available for this video/language.',
      'NO_CAPTIONS',
      false,
    );
  } catch (err) {
    if (err instanceof TranscriptFetchError) throw err;
    throw new TranscriptFetchError(
      err?.message || 'Transcript fetch failed.',
      'TRANSIENT_FETCH_ERROR',
      true,
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}
