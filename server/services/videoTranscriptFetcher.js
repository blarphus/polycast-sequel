import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MANAGED_BIN_DIR = path.join(os.tmpdir(), 'polycast-tools');
const MANAGED_YTDLP_BINARY = path.join(MANAGED_BIN_DIR, 'yt-dlp');
const YTDLP_BINARY_ENV = process.env.YTDLP_BINARY || null;
const YTDLP_DOWNLOAD_URL = process.env.YTDLP_DOWNLOAD_URL ||
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

let resolvedYtDlpBinaryPromise = null;

export class TranscriptFetchError extends Error {
  constructor(message, code, transient = false) {
    super(message);
    this.name = 'TranscriptFetchError';
    this.code = code;
    this.transient = transient;
  }
}

async function commandWorks(commandPath, args = ['--version']) {
  return new Promise((resolve) => {
    const child = spawn(commandPath, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve(false);
    }, 8000);

    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(false);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function ensureManagedYtDlpBinary() {
  await fs.mkdir(MANAGED_BIN_DIR, { recursive: true });

  const response = await fetch(YTDLP_DOWNLOAD_URL, {
    redirect: 'follow',
    headers: { 'User-Agent': 'polycast-sequel/1.0' },
  });

  if (!response.ok) {
    throw new TranscriptFetchError(
      `Failed to download yt-dlp binary (${response.status}).`,
      'CONFIG_ERROR',
      false,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const tempFile = `${MANAGED_YTDLP_BINARY}.tmp`;
  await fs.writeFile(tempFile, bytes, { mode: 0o755 });
  await fs.rename(tempFile, MANAGED_YTDLP_BINARY);
  await fs.chmod(MANAGED_YTDLP_BINARY, 0o755);
}

async function resolveYtDlpBinary() {
  if (YTDLP_BINARY_ENV) {
    const exists = await commandWorks(YTDLP_BINARY_ENV);
    if (exists) return YTDLP_BINARY_ENV;
  }

  if (await commandWorks('yt-dlp')) {
    return 'yt-dlp';
  }

  if (await commandWorks(MANAGED_YTDLP_BINARY)) {
    return MANAGED_YTDLP_BINARY;
  }

  await ensureManagedYtDlpBinary();

  if (await commandWorks(MANAGED_YTDLP_BINARY)) {
    return MANAGED_YTDLP_BINARY;
  }

  throw new TranscriptFetchError(
    'yt-dlp binary is not available on the server.',
    'CONFIG_ERROR',
    false,
  );
}

async function getYtDlpBinary() {
  if (!resolvedYtDlpBinaryPromise) {
    resolvedYtDlpBinaryPromise = resolveYtDlpBinary().catch((err) => {
      resolvedYtDlpBinaryPromise = null;
      throw err;
    });
  }
  return resolvedYtDlpBinaryPromise;
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
      normalized.includes('permission denied') ||
      normalized.includes('not found')) {
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

  const ytDlpBinary = await getYtDlpBinary();

  await new Promise((resolve, reject) => {
    const child = spawn(ytDlpBinary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
