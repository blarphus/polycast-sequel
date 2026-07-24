import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import worker from '../src/index.js';

const SECRET = 'server-only-test-secret';

function memoryKV() {
  const values = new Map();
  return {
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) { values.set(key, value); },
  };
}

function makeEnv(overrides = {}) {
  return {
    AUTH_SECRET: SECRET,
    AUTH_REPLAY: memoryKV(),
    ALLOWED_ORIGINS: 'https://app.example.test',
    INNERTUBE_API_KEY: 'test-public-client-id',
    AI: { run: async () => new Uint8Array() },
    ...overrides,
  };
}

function token(scope = 'transcript', { now = Date.now(), lifetime = 30, subject = 'user-1', secret = SECRET, jti } = {}) {
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    iss: 'polycast-server',
    sub: subject,
    scope,
    iat: issuedAt,
    exp: issuedAt + lifetime,
    jti: jti || randomBytes(18).toString('base64url'),
  })).toString('base64url');
  const unsigned = `p1.${payload}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

function authorizedRequest(url, bearer = token(), init = {}) {
  return new Request(url, {
    ...init,
    headers: { Authorization: `Bearer ${bearer}`, 'X-Correlation-ID': 'test-correlation', ...(init.headers || {}) },
  });
}

test('rejects privileged requests from an allowed browser origin without bearer auth', async () => {
  const response = await worker.fetch(new Request('https://worker.example.test/?videoId=abcdefghijk', {
    headers: { Origin: 'https://app.example.test' },
  }), makeEnv());
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://app.example.test');
  assert.equal((await response.json()).fallback_notices[0].code, 'worker_token_invalid');
});

test('rejects the rotated/old static bearer value', async () => {
  const response = await worker.fetch(authorizedRequest(
    'https://worker.example.test/?videoId=abcdefghijk',
    'old-secret',
  ), makeEnv());
  assert.equal(response.status, 401);
});

test('rejects expired and overlong tokens with a visible diagnostic', async () => {
  const expired = await worker.fetch(authorizedRequest(
    'https://worker.example.test/?videoId=abcdefghijk',
    token('transcript', { now: Date.now() - 120_000 }),
  ), makeEnv());
  const overlong = await worker.fetch(authorizedRequest(
    'https://worker.example.test/?videoId=abcdefghijk',
    token('transcript', { lifetime: 120 }),
  ), makeEnv());
  assert.equal(expired.status, 401);
  assert.equal(overlong.status, 401);
  assert.equal((await expired.json()).fallback_notices[0].code, 'worker_token_expired');
});

test('rejects a token whose action scope does not match', async () => {
  const response = await worker.fetch(authorizedRequest(
    'https://worker.example.test/?action=related&videoId=abcdefghijk',
    token('transcript'),
  ), makeEnv());
  assert.equal(response.status, 401);
  assert.equal((await response.json()).fallback_notices[0].code, 'worker_token_scope_mismatch');
});

test('rejects replay of a single-use token', async () => {
  const env = makeEnv({ INNERTUBE_API_KEY: '' });
  const bearer = token();
  const url = 'https://worker.example.test/?videoId=abcdefghijk';
  const first = await worker.fetch(authorizedRequest(url, bearer), env);
  const replay = await worker.fetch(authorizedRequest(url, bearer), env);
  assert.equal(first.status, 503);
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).fallback_notices[0].code, 'worker_token_replayed');
});

test('enforces an independent per-action subject quota', async () => {
  const env = makeEnv({ INNERTUBE_API_KEY: '', QUOTA_TRANSCRIPT: '1' });
  const url = 'https://worker.example.test/?videoId=abcdefghijk';
  await worker.fetch(authorizedRequest(url, token()), env);
  const limited = await worker.fetch(authorizedRequest(url, token()), env);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).fallback_notices[0].code, 'worker_action_quota_exhausted');
});

test('requires replay and provider configuration after authentication', async () => {
  const missingReplay = await worker.fetch(authorizedRequest(
    'https://worker.example.test/?videoId=abcdefghijk',
  ), makeEnv({ AUTH_REPLAY: undefined }));
  assert.equal(missingReplay.status, 503);
  assert.equal((await missingReplay.json()).fallback_notices[0].code, 'worker_auth_configuration_missing');

  const missingProvider = await worker.fetch(authorizedRequest(
    'https://worker.example.test/?videoId=abcdefghijk',
  ), makeEnv({ INNERTUBE_API_KEY: '' }));
  assert.equal(missingProvider.status, 503);
  assert.equal((await missingProvider.json()).fallback_notices[0].code, 'media_provider_configuration_missing');
});

test('preflight only reflects explicitly allowed origins', async () => {
  const env = makeEnv();
  const allowed = await worker.fetch(new Request('https://worker.example.test/', {
    method: 'OPTIONS',
    headers: { Origin: 'https://app.example.test' },
  }), env);
  const denied = await worker.fetch(new Request('https://worker.example.test/', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example.test' },
  }), env);
  assert.equal(allowed.status, 204);
  assert.equal(denied.status, 403);
});

test('rejects malformed and oversized playability batches before provider work', async () => {
  const malformed = await worker.fetch(authorizedRequest(
    'https://worker.example.test/?action=check',
    token('check'),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoIds: ['invalid$id'] }) },
  ), makeEnv());
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /valid YouTube IDs/);

  const oversized = await worker.fetch(authorizedRequest(
    'https://worker.example.test/?action=check',
    token('check'),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoIds: Array(51).fill('abcdefghijk') }) },
  ), makeEnv());
  assert.equal(oversized.status, 400);
});

test('playability retries a provider timeout with a bounded alternate client before falling back', async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies = [];
  globalThis.fetch = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    if (requestBodies.length === 1) throw new DOMException('provider deadline exceeded', 'TimeoutError');
    return Response.json({
      playabilityStatus: { status: 'OK' },
      streamingData: { adaptiveFormats: [{ width: 1280, height: 720 }] },
    });
  };
  try {
    const response = await worker.fetch(authorizedRequest(
      'https://worker.example.test/?action=check',
      token('check'),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoIds: ['abcdefghijk'] }) },
    ), makeEnv());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.results.abcdefghijk, { status: 'OK', isShort: false });
    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies[0].context.client.clientName, 'IOS');
    assert.equal(requestBodies[1].context.client.clientName, 'ANDROID');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('playability keeps a repeated timeout visible after the bounded retry is exhausted', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new DOMException('provider deadline exceeded', 'TimeoutError');
  };
  try {
    const response = await worker.fetch(authorizedRequest(
      'https://worker.example.test/?action=check',
      token('check'),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoIds: ['abcdefghijk'] }) },
    ), makeEnv());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(body.results.abcdefghijk.status, 'ERROR');
    assert.equal(body.results.abcdefghijk.diagnostic.code, 'playability_provider_timeout');
    assert.match(body.results.abcdefghijk.diagnostic.detail, /attempts=2/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uses the first caption track only with a detailed visible alternate-language diagnostic', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return Response.json({
      playabilityStatus: { status: 'OK' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [
        { languageCode: 'es', kind: 'asr', baseUrl: 'https://captions.example.test/timed?x=1' },
      ] } },
    });
    return Response.json({ events: [{ tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: 'hola' }] }] });
  };
  try {
    const response = await worker.fetch(authorizedRequest(
      'https://worker.example.test/?videoId=abcdefghijk&lang=fr',
      token('transcript'),
    ), makeEnv());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.selectedLanguage, 'es');
    assert.equal(body.fallback_notices[0].code, 'caption_language_track_fallback');
    assert.equal(body.fallback_notices[0].correlationId, 'test-correlation');
    assert.match(body.fallback_notices[0].detail, /requestedLanguage=fr; selectedLanguage=es/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider timeout returns a correlated visible diagnostic', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException('provider deadline exceeded', 'TimeoutError'); };
  try {
    const response = await worker.fetch(authorizedRequest(
      'https://worker.example.test/?videoId=abcdefghijk',
      token('transcript'),
    ), makeEnv());
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.fallback_notices[0].code, 'transcript_player_timeout');
    assert.equal(body.fallback_notices[0].correlationId, 'test-correlation');
    assert.match(body.fallback_notices[0].detail, /provider deadline exceeded/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
