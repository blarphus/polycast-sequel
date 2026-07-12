import { createHmac, randomBytes } from 'node:crypto';

const MAX_VIDEO_IDS = 50;
const TOKEN_LIFETIME_SECONDS = 30;
const ALLOWED_SCOPES = new Set(['transcript', 'related', 'check', 'tts']);

function configuration() {
  const url = process.env.CF_TRANSCRIPT_WORKER_URL;
  const secret = process.env.CF_TRANSCRIPT_WORKER_SECRET;
  if (!url || !secret) {
    const error = new Error('Media worker is not configured');
    error.status = 503;
    throw error;
  }
  return { url, secret };
}

export function createMediaWorkerToken(scope, subject, { now = Date.now(), secret } = {}) {
  if (!ALLOWED_SCOPES.has(scope)) throw new Error(`Unsupported media Worker scope: ${scope}`);
  const signingSecret = secret || configuration().secret;
  const issuedAt = Math.floor(now / 1000);
  const claims = {
    v: 1,
    iss: 'polycast-server',
    sub: String(subject || 'server'),
    scope,
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
    jti: randomBytes(18).toString('base64url'),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const unsigned = `p1.${payload}`;
  const signature = createHmac('sha256', signingSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function workerHeaders(scope, { userId, correlationId } = {}, extra = {}) {
  return {
    Authorization: `Bearer ${createMediaWorkerToken(scope, userId)}`,
    'X-Correlation-ID': correlationId || crypto.randomUUID(),
    ...extra,
  };
}

async function parseWorkerPayload(response) {
  return response.json().catch(() => null);
}

function workerFailure(response, payload, operation) {
  const error = new Error(payload?.error || `Media worker ${operation} returned ${response.status}`);
  error.upstreamStatus = response.status;
  error.status = response.status === 429 ? 429 : (response.status === 401 ? 502 : response.status === 503 ? 503 : 502);
  error.fallbackNotices = Array.isArray(payload?.fallback_notices) ? payload.fallback_notices : [];
  return error;
}

export async function checkVideoPlayability(videoIds, context = {}) {
  const ids = [...new Set(videoIds)].slice(0, MAX_VIDEO_IDS);
  const { url } = configuration();
  const endpoint = new URL(url);
  endpoint.searchParams.set('action', 'check');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: workerHeaders('check', context, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ videoIds: ids }),
  });
  const payload = await parseWorkerPayload(response);
  if (!response.ok || !payload?.success || !payload.results) throw workerFailure(response, payload, 'playability');
  return payload.results;
}

async function workerJson(endpoint, options, operation) {
  const response = await fetch(endpoint, options);
  const payload = await parseWorkerPayload(response);
  if (!response.ok || !payload?.success) throw workerFailure(response, payload, operation);
  return payload;
}

export async function fetchTimedTranscript(youtubeId, language, context = {}) {
  const { url } = configuration();
  const endpoint = new URL(url);
  endpoint.searchParams.set('videoId', youtubeId);
  endpoint.searchParams.set('lang', language);
  const payload = await workerJson(endpoint, { headers: workerHeaders('transcript', context) }, 'transcript');
  return {
    ...payload,
    segments: payload.segments.map((segment) => ({
      text: segment.text,
      offset: Math.max(0, Math.round(Number(segment.start) * 1000)),
      duration: Math.max(0, Math.round(Number(segment.dur) * 1000)),
      words: Array.isArray(segment.words) ? segment.words : [],
    })),
  };
}

export async function fetchRelatedVideos(youtubeId, context = {}) {
  const { url } = configuration();
  const endpoint = new URL(url);
  endpoint.searchParams.set('action', 'related');
  endpoint.searchParams.set('videoId', youtubeId);
  return workerJson(endpoint, { headers: workerHeaders('related', context) }, 'related');
}

export async function synthesizeWorkerSpeech(text, languageCode, context = {}) {
  const { url } = configuration();
  const endpoint = new URL(url);
  endpoint.searchParams.set('action', 'tts');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: workerHeaders('tts', context, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text, languageCode }),
  });
  if (!response.ok) {
    const payload = await parseWorkerPayload(response);
    throw workerFailure(response, payload, 'tts');
  }
  return Buffer.from(await response.arrayBuffer());
}
