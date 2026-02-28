import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from 'youtube-transcript-plus';

const MANAGED_BIN_DIR = path.join(os.tmpdir(), 'polycast-tools');
const MANAGED_YTDLP_BINARY = path.join(MANAGED_BIN_DIR, 'yt-dlp');
const YTDLP_BINARY_ENV = process.env.YTDLP_BINARY || null;
const YTDLP_DOWNLOAD_URL = process.env.YTDLP_DOWNLOAD_URL ||
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
const YTDLP_PROXY_LIST_URL = process.env.YTDLP_PROXY_LIST_URL ||
  'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all';
const YTDLP_PROXY_MAX_ATTEMPTS = Number(process.env.YTDLP_PROXY_MAX_ATTEMPTS || 20);
const YTDLP_PROXY_CACHE_MS = Number(process.env.YTDLP_PROXY_CACHE_MS || 120000);
const YTDLP_PROXY_ENABLED = process.env.YTDLP_PROXY_ENABLED !== 'false';
const YTDLP_SOCKET_TIMEOUT_SECONDS = String(process.env.YTDLP_SOCKET_TIMEOUT_SECONDS || 8);
const YTDLP_ATTEMPT_TIMEOUT_MS = Number(process.env.YTDLP_ATTEMPT_TIMEOUT_MS || 25000);
const YOUTUBE_TRANSCRIPT_REQUEST_TIMEOUT_MS =
  Number(process.env.YOUTUBE_TRANSCRIPT_REQUEST_TIMEOUT_MS || 20000);
const YOUTUBE_TRANSCRIPT_USER_AGENT = process.env.YOUTUBE_TRANSCRIPT_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const VCYON_ENABLED = process.env.VCYON_ENABLED !== 'false';
const VCYON_TRANSCRIPT_API_URL = process.env.VCYON_TRANSCRIPT_API_URL ||
  'https://api.vcyon.com/v1/youtube/transcript';
const VCYON_API_KEY = process.env.VCYON_API_KEY || '';
const VCYON_TIMEOUT_MS = Number(process.env.VCYON_TIMEOUT_MS || 25000);

let resolvedYtDlpBinaryPromise = null;
let proxyCache = { expiresAt: 0, proxies: [] };

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

function normalizeProxy(proxyLine) {
  const trimmed = proxyLine.trim().replace(/\r/g, '');
  if (!trimmed) return null;
  if (!/^[a-z]+:\/\//i.test(trimmed)) return `http://${trimmed}`;
  return trimmed;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

async function getProxyCandidates() {
  const now = Date.now();
  if (proxyCache.expiresAt > now && proxyCache.proxies.length > 0) {
    return proxyCache.proxies;
  }

  if (!YTDLP_PROXY_ENABLED) return [];

  try {
    const response = await fetch(YTDLP_PROXY_LIST_URL, {
      headers: { 'User-Agent': 'polycast-sequel/1.0' },
    });
    if (!response.ok) return [];
    const body = await response.text();
    const proxies = body
      .split('\n')
      .map(normalizeProxy)
      .filter(Boolean);
    shuffleInPlace(proxies);
    proxyCache = { expiresAt: now + YTDLP_PROXY_CACHE_MS, proxies };
    return proxies;
  } catch {
    return [];
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

async function fetchWithTimeout({
  url,
  method = 'GET',
  body,
  headers = {},
  lang,
  userAgent,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YOUTUBE_TRANSCRIPT_REQUEST_TIMEOUT_MS);

  try {
    const mergedHeaders = {
      ...headers,
      'User-Agent': userAgent || YOUTUBE_TRANSCRIPT_USER_AGENT,
    };

    if (lang) {
      mergedHeaders['Accept-Language'] = lang;
    }

    return await fetch(url, {
      method,
      body,
      headers: mergedHeaders,
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTranscriptPlusSegments(items) {
  const segments = [];

  for (const item of items || []) {
    const text = String(item?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const offsetSeconds = Number(item?.offset);
    const durationSeconds = Number(item?.duration);
    if (!Number.isFinite(offsetSeconds) || !Number.isFinite(durationSeconds)) continue;

    const offset = Math.max(0, Math.round(offsetSeconds * 1000));
    const duration = Math.max(0, Math.round(durationSeconds * 1000));

    segments.push({ text, offset, duration });
  }

  return segments;
}

function mapTranscriptPlusError(err) {
  if (err instanceof YoutubeTranscriptTooManyRequestError) {
    return new TranscriptFetchError(
      'YouTube temporarily blocked transcript requests.',
      'BLOCKED_OR_RATE_LIMITED',
      true,
    );
  }

  if (err instanceof YoutubeTranscriptVideoUnavailableError) {
    return new TranscriptFetchError(
      'Video is unavailable for transcript extraction.',
      'SOURCE_UNAVAILABLE',
      false,
    );
  }

  if (err instanceof YoutubeTranscriptDisabledError) {
    return new TranscriptFetchError(
      'No YouTube captions available for this video/language.',
      'NO_CAPTIONS',
      false,
    );
  }

  if (err instanceof YoutubeTranscriptNotAvailableLanguageError) {
    return new TranscriptFetchError(
      'Requested caption language is not available for this video.',
      'NO_CAPTIONS',
      false,
    );
  }

  if (err instanceof YoutubeTranscriptNotAvailableError) {
    return new TranscriptFetchError(
      'Transcript fetch temporarily failed.',
      'TRANSIENT_FETCH_ERROR',
      true,
    );
  }

  if (err?.name === 'AbortError') {
    return new TranscriptFetchError(
      'Transcript request timed out.',
      'TRANSIENT_FETCH_ERROR',
      true,
    );
  }

  return new TranscriptFetchError(
    err?.message || 'Transcript fetch temporarily failed.',
    'TRANSIENT_FETCH_ERROR',
    true,
  );
}

async function fetchViaTranscriptPlus(youtubeId, language) {
  const lang = (language || '').trim().toLowerCase();

  const baseConfig = {
    userAgent: YOUTUBE_TRANSCRIPT_USER_AGENT,
    videoFetch: fetchWithTimeout,
    playerFetch: fetchWithTimeout,
    transcriptFetch: fetchWithTimeout,
  };

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(youtubeId, {
      ...baseConfig,
      ...(lang ? { lang } : {}),
    });
    const segments = normalizeTranscriptPlusSegments(transcript);
    if (segments.length > 0) {
      return { segments, source: 'youtubei' };
    }
    throw new TranscriptFetchError(
      'No YouTube captions available for this video/language.',
      'NO_CAPTIONS',
      false,
    );
  } catch (err) {
    if (err instanceof YoutubeTranscriptNotAvailableLanguageError) {
      // If exact language is unavailable, accept the first available track.
      try {
        const transcript = await YoutubeTranscript.fetchTranscript(youtubeId, baseConfig);
        const segments = normalizeTranscriptPlusSegments(transcript);
        if (segments.length > 0) {
          return { segments, source: 'youtubei' };
        }
      } catch (fallbackErr) {
        throw mapTranscriptPlusError(fallbackErr);
      }
    }

    if (err instanceof TranscriptFetchError) throw err;
    throw mapTranscriptPlusError(err);
  }
}

function normalizeVcyonSegments(items) {
  const segments = [];

  for (const item of items || []) {
    const text = String(item?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const start = Number(item?.start ?? item?.offset ?? 0);
    const end = Number(item?.end);
    const rawDuration = Number(item?.duration);

    if (!Number.isFinite(start)) continue;

    let duration = 0;
    if (Number.isFinite(end) && end >= start) {
      duration = end - start;
    } else if (Number.isFinite(rawDuration) && rawDuration >= 0) {
      duration = rawDuration;
    }

    segments.push({
      text,
      offset: Math.max(0, Math.round(start)),
      duration: Math.max(0, Math.round(duration)),
    });
  }

  return segments;
}

async function fetchViaVcyon(youtubeId, language) {
  if (!VCYON_ENABLED) {
    throw new TranscriptFetchError(
      'External transcript provider disabled.',
      'CONFIG_ERROR',
      false,
    );
  }

  const requestUrl = new URL(VCYON_TRANSCRIPT_API_URL);
  requestUrl.searchParams.set('videoId', youtubeId);
  if (language) {
    requestUrl.searchParams.set('lang', language);
  }

  const headers = {
    Accept: 'application/json',
    'User-Agent': 'polycast-sequel/1.0',
  };

  if (VCYON_API_KEY) {
    headers.Authorization = `Bearer ${VCYON_API_KEY}`;
    headers['x-api-key'] = VCYON_API_KEY;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VCYON_TIMEOUT_MS);

  try {
    const response = await fetch(requestUrl, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const msg = `${response.status} ${body}`.toLowerCase();

      if (msg.includes('api key') || msg.includes('unauthorized') || response.status === 401) {
        throw new TranscriptFetchError(
          'External transcript provider rejected credentials.',
          'CONFIG_ERROR',
          false,
        );
      }

      if (response.status === 404) {
        throw new TranscriptFetchError(
          'No YouTube captions available for this video/language.',
          'NO_CAPTIONS',
          false,
        );
      }

      throw new TranscriptFetchError(
        'External transcript provider temporarily unavailable.',
        'TRANSIENT_FETCH_ERROR',
        true,
      );
    }

    const data = await response.json();
    if (!data || data.success === false) {
      const message = String(data?.error || data?.message || '').toLowerCase();

      if (message.includes('api key') || message.includes('unauthorized')) {
        throw new TranscriptFetchError(
          'External transcript provider rejected credentials.',
          'CONFIG_ERROR',
          false,
        );
      }

      if (message.includes('no transcript') || message.includes('no captions')) {
        throw new TranscriptFetchError(
          'No YouTube captions available for this video/language.',
          'NO_CAPTIONS',
          false,
        );
      }

      throw new TranscriptFetchError(
        'External transcript provider temporarily unavailable.',
        'TRANSIENT_FETCH_ERROR',
        true,
      );
    }

    const hasTranscript = Boolean(data?.data?.hasTranscript);
    const segments = normalizeVcyonSegments(data?.data?.segments);

    if (!hasTranscript || segments.length === 0) {
      throw new TranscriptFetchError(
        'No YouTube captions available for this video/language.',
        'NO_CAPTIONS',
        false,
      );
    }

    return { segments, source: 'vcyon' };
  } catch (err) {
    if (err instanceof TranscriptFetchError) throw err;

    if (err?.name === 'AbortError') {
      throw new TranscriptFetchError(
        'External transcript provider timed out.',
        'TRANSIENT_FETCH_ERROR',
        true,
      );
    }

    throw new TranscriptFetchError(
      err?.message || 'External transcript provider temporarily unavailable.',
      'TRANSIENT_FETCH_ERROR',
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

function classifyYtDlpFailure(stderrText) {
  const normalized = stderrText.toLowerCase();

  if (normalized.includes('captcha') ||
      normalized.includes('too many requests') ||
      normalized.includes('http error 429') ||
      normalized.includes('sign in to confirm') ||
      normalized.includes('precondition check failed') ||
      normalized.includes('failed_precondition') ||
      normalized.includes('page needs to be reloaded')) {
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
    '--geo-bypass',
    '--socket-timeout', YTDLP_SOCKET_TIMEOUT_SECONDS,
    '--sub-format', 'vtt',
    '--sub-langs', language,
    '--extractor-args', 'youtube:player_client=tv,android,web_embedded',
    '--extractor-args', 'youtube:player_skip=webpage',
    '--output', outTemplate,
  ];

  if (mode === 'manual') {
    args.push('--write-subs');
  } else {
    args.push('--write-auto-subs');
  }

  const ytDlpBinary = await getYtDlpBinary();

  const execAttempt = (extraArgs = []) => new Promise((resolve, reject) => {
    const child = spawn(ytDlpBinary, [...args, ...extraArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let timedOut = false;

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, YTDLP_ATTEMPT_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(classifyYtDlpFailure(`${stderr}\n${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(classifyYtDlpFailure(`${stderr}\nTimed out after ${YTDLP_ATTEMPT_TIMEOUT_MS}ms`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(classifyYtDlpFailure(stderr));
    });
  });

  try {
    await execAttempt();
    return;
  } catch (err) {
    const directErr = err instanceof TranscriptFetchError
      ? err
      : new TranscriptFetchError('Transcript fetch temporarily failed.', 'TRANSIENT_FETCH_ERROR', true);

    if (directErr.code !== 'BLOCKED_OR_RATE_LIMITED' || !YTDLP_PROXY_ENABLED) {
      throw directErr;
    }

    const proxies = await getProxyCandidates();
    if (proxies.length === 0) {
      throw directErr;
    }

    let lastErr = directErr;
    for (const proxy of proxies.slice(0, YTDLP_PROXY_MAX_ATTEMPTS)) {
      try {
        await execAttempt(['--proxy', proxy]);
        return;
      } catch (proxyErr) {
        if (proxyErr instanceof TranscriptFetchError) {
          // Hard terminal states should short-circuit retries.
          if (proxyErr.code === 'NO_CAPTIONS' || proxyErr.code === 'SOURCE_UNAVAILABLE') {
            throw proxyErr;
          }
          lastErr = proxyErr;
        }
      }
    }

    throw lastErr;
  }
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
 * Fetch transcript segments from YouTube captions.
 * Primary strategy matches modern Innertube caption extraction (like Vidscript),
 * with yt-dlp as backup when YouTube transiently blocks requests.
 */
export async function fetchYouTubeTranscript(youtubeId, language = 'en') {
  const normalizedLang = (language || 'en').trim().toLowerCase();

  let mappedPrimaryErr;
  try {
    return await fetchViaTranscriptPlus(youtubeId, normalizedLang);
  } catch (primaryErr) {
    mappedPrimaryErr = primaryErr instanceof TranscriptFetchError
      ? primaryErr
      : new TranscriptFetchError(
        primaryErr?.message || 'Transcript fetch failed.',
        'TRANSIENT_FETCH_ERROR',
        true,
      );
  }

  // External provider fallback is highly reliable when Render IPs are blocked by YouTube.
  let externalProviderError = null;
  try {
    return await fetchViaVcyon(youtubeId, normalizedLang);
  } catch (err) {
    externalProviderError = err instanceof TranscriptFetchError
      ? err
      : new TranscriptFetchError(
        err?.message || 'External transcript provider temporarily unavailable.',
        'TRANSIENT_FETCH_ERROR',
        true,
      );
  }

  // Use yt-dlp+proxy fallback for transient failures from either primary or external provider.
  const primaryAllowsYtDlp = mappedPrimaryErr.transient &&
    (mappedPrimaryErr.code === 'BLOCKED_OR_RATE_LIMITED' ||
     mappedPrimaryErr.code === 'TRANSIENT_FETCH_ERROR');
  const shouldTryYtDlp = primaryAllowsYtDlp || Boolean(externalProviderError?.transient);

  if (!shouldTryYtDlp) {
    if (externalProviderError) throw externalProviderError;
    throw mappedPrimaryErr;
  }

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

    if (externalProviderError) throw externalProviderError;
    throw mappedPrimaryErr;
  } catch (fallbackErr) {
    if (fallbackErr instanceof TranscriptFetchError) throw fallbackErr;
    throw new TranscriptFetchError(
      fallbackErr?.message || mappedPrimaryErr.message,
      'TRANSIENT_FETCH_ERROR',
      true,
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}
