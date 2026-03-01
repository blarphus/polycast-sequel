import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from 'youtube-transcript-plus';

const YOUTUBE_TRANSCRIPT_REQUEST_TIMEOUT_MS =
  Number(process.env.YOUTUBE_TRANSCRIPT_REQUEST_TIMEOUT_MS || 20000);
const YOUTUBE_TRANSCRIPT_USER_AGENT = process.env.YOUTUBE_TRANSCRIPT_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

async function fetchWithTimeout({ url, method = 'GET', body, headers = {}, lang, userAgent }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YOUTUBE_TRANSCRIPT_REQUEST_TIMEOUT_MS);

  try {
    const mergedHeaders = {
      ...headers,
      'User-Agent': userAgent || YOUTUBE_TRANSCRIPT_USER_AGENT,
    };
    if (lang) mergedHeaders['Accept-Language'] = lang;

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

    segments.push({
      text,
      offset: Math.max(0, Math.round(offsetSeconds * 1000)),
      duration: Math.max(0, Math.round(durationSeconds * 1000)),
    });
  }
  return segments;
}

function mapTranscriptPlusError(err) {
  if (err instanceof YoutubeTranscriptTooManyRequestError) {
    return new TranscriptFetchError('YouTube temporarily blocked transcript requests.', 'BLOCKED_OR_RATE_LIMITED', true);
  }
  if (err instanceof YoutubeTranscriptVideoUnavailableError) {
    return new TranscriptFetchError('Video is unavailable for transcript extraction.', 'SOURCE_UNAVAILABLE', true);
  }
  if (err instanceof YoutubeTranscriptDisabledError) {
    return new TranscriptFetchError('No YouTube captions available for this video/language.', 'NO_CAPTIONS', false);
  }
  if (err instanceof YoutubeTranscriptNotAvailableLanguageError) {
    return new TranscriptFetchError('Requested caption language is not available for this video.', 'NO_CAPTIONS', false);
  }
  if (err instanceof YoutubeTranscriptNotAvailableError) {
    return new TranscriptFetchError('Transcript fetch temporarily failed.', 'TRANSIENT_FETCH_ERROR', true);
  }
  if (err?.name === 'AbortError') {
    return new TranscriptFetchError('Transcript request timed out.', 'TRANSIENT_FETCH_ERROR', true);
  }
  return new TranscriptFetchError(err?.message || 'Transcript fetch temporarily failed.', 'TRANSIENT_FETCH_ERROR', true);
}

async function fetchViaTranscriptPlus(youtubeId, language, onProgress) {
  const lang = (language || '').trim().toLowerCase();

  const wrapFetch = (originalFetch, progressValue) => {
    return async (opts) => {
      const result = await originalFetch(opts);
      if (onProgress) onProgress(progressValue);
      return result;
    };
  };

  const baseConfig = {
    userAgent: YOUTUBE_TRANSCRIPT_USER_AGENT,
    videoFetch: onProgress ? wrapFetch(fetchWithTimeout, 30) : fetchWithTimeout,
    playerFetch: onProgress ? wrapFetch(fetchWithTimeout, 55) : fetchWithTimeout,
    transcriptFetch: onProgress ? wrapFetch(fetchWithTimeout, 80) : fetchWithTimeout,
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
    throw new TranscriptFetchError('No YouTube captions available for this video/language.', 'NO_CAPTIONS', false);
  } catch (err) {
    if (err instanceof YoutubeTranscriptNotAvailableLanguageError) {
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

export async function fetchYouTubeTranscript(youtubeId, language = 'en', onProgress) {
  const normalizedLang = (language || 'en').trim().toLowerCase();
  return fetchViaTranscriptPlus(youtubeId, normalizedLang, onProgress);
}
