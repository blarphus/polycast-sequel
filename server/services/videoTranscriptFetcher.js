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
const INNERTUBE_API_KEY = process.env.INNERTUBE_API_KEY || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

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

function parseTranscriptXml(xml) {
  const segments = [];
  const regex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = decodeEntities(match[3]).replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const offsetSeconds = Number(match[1]);
    const durationSeconds = Number(match[2]);
    if (!Number.isFinite(offsetSeconds) || !Number.isFinite(durationSeconds)) continue;

    segments.push({
      text,
      offset: Math.max(0, Math.round(offsetSeconds * 1000)),
      duration: Math.max(0, Math.round(durationSeconds * 1000)),
    });
  }
  return segments;
}

function parseTranscriptJson3(json3) {
  const segments = [];
  for (const event of json3?.events || []) {
    if (!event.segs) continue;

    const text = event.segs.map(s => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const offset = Number(event.tStartMs);
    const duration = Number(event.dDurationMs);
    if (!Number.isFinite(offset) || !Number.isFinite(duration)) continue;

    segments.push({
      text,
      offset: Math.max(0, offset),
      duration: Math.max(0, duration),
    });
  }
  return segments;
}

async function fetchViaInnertubeDirect(youtubeId, language, onProgress) {
  // Step 1: Player API — get caption tracks
  const playerUrl = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`;
  const playerBody = JSON.stringify({
    context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
    videoId: youtubeId,
  });

  let playerData;
  try {
    const playerRes = await fetchWithTimeout({
      url: playerUrl,
      method: 'POST',
      body: playerBody,
      headers: { 'Content-Type': 'application/json' },
    });
    if (!playerRes.ok) {
      const code = playerRes.status === 429 ? 'BLOCKED_OR_RATE_LIMITED' : 'TRANSIENT_FETCH_ERROR';
      throw new TranscriptFetchError(`Player API returned ${playerRes.status}`, code, true);
    }
    playerData = await playerRes.json();
  } catch (err) {
    if (err instanceof TranscriptFetchError) throw err;
    if (err?.name === 'AbortError') {
      throw new TranscriptFetchError('Player API request timed out.', 'TRANSIENT_FETCH_ERROR', true);
    }
    throw new TranscriptFetchError(`Player API request failed: ${err.message}`, 'TRANSIENT_FETCH_ERROR', true);
  }

  const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captionTracks || captionTracks.length === 0) {
    throw new TranscriptFetchError('No YouTube captions available for this video.', 'NO_CAPTIONS', false);
  }

  if (onProgress) onProgress(30);

  // Find matching language track, fall back to first track
  const track = captionTracks.find(t => t.languageCode === language) || captionTracks[0];
  // Strip any existing &fmt= param and request json3 format
  const baseUrl = track.baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3';

  // Step 2: Timedtext JSON3 — fetch and parse transcript
  let json3;
  try {
    const ttRes = await fetchWithTimeout({ url: baseUrl });
    if (!ttRes.ok) {
      const code = ttRes.status === 429 ? 'BLOCKED_OR_RATE_LIMITED' : 'TRANSIENT_FETCH_ERROR';
      throw new TranscriptFetchError(`Timedtext request returned ${ttRes.status}`, code, true);
    }
    json3 = await ttRes.json();
  } catch (err) {
    if (err instanceof TranscriptFetchError) throw err;
    if (err?.name === 'AbortError') {
      throw new TranscriptFetchError('Timedtext request timed out.', 'TRANSIENT_FETCH_ERROR', true);
    }
    throw new TranscriptFetchError(`Timedtext request failed: ${err.message}`, 'TRANSIENT_FETCH_ERROR', true);
  }

  const segments = parseTranscriptJson3(json3);
  if (segments.length === 0) {
    throw new TranscriptFetchError('No YouTube captions available for this video/language.', 'NO_CAPTIONS', false);
  }

  if (onProgress) onProgress(80);

  return { segments, source: 'innertube' };
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

  // Primary: direct Innertube API (no watch page scrape)
  try {
    return await fetchViaInnertubeDirect(youtubeId, normalizedLang, onProgress);
  } catch (directErr) {
    console.warn(`[transcript] Direct Innertube failed for ${youtubeId}:`, directErr.message);
  }

  // Fallback: full youtube-transcript-plus flow
  return fetchViaTranscriptPlus(youtubeId, normalizedLang, onProgress);
}
