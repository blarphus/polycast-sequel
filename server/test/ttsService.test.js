import assert from 'node:assert/strict';
import test from 'node:test';
import { audioContentType, synthesizeVoiceFeedback } from '../services/ttsService.js';

test('audioContentType identifies Cloudflare WAV and MP3 responses', () => {
  assert.equal(audioContentType(Buffer.from('RIFF1234WAVEdata')), 'audio/wav');
  assert.equal(audioContentType(Buffer.from([0xff, 0xfb, 0x90, 0x64])), 'audio/mpeg');
});

test('synthesizeVoiceFeedback proxies Cloudflare audio through the private worker', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.CF_TRANSCRIPT_WORKER_URL;
  const originalSecret = process.env.CF_TRANSCRIPT_WORKER_SECRET;
  process.env.CF_TRANSCRIPT_WORKER_URL = 'https://worker.example.test/transcripts?existing=1';
  process.env.CF_TRANSCRIPT_WORKER_SECRET = 'test-secret';

  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://worker.example.test/transcripts?existing=1&action=tts');
    const token = options.headers.Authorization.replace('Bearer ', '');
    assert.notEqual(token, 'test-secret');
    const [, encodedClaims] = token.split('.');
    const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8'));
    assert.equal(claims.scope, 'tts');
    assert.equal(claims.sub, 'server');
    assert.ok(claims.exp > claims.iat);
    assert.deepEqual(JSON.parse(options.body), { text: 'Hola mundo', languageCode: 'es-MX' });
    return new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  };

  try {
    const result = await synthesizeVoiceFeedback({ text: 'Hola mundo', languageCode: 'es-MX' });
    assert.deepEqual([...result.audioBuffer], [1, 2, 3]);
    assert.equal(result.usedFallback, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.CF_TRANSCRIPT_WORKER_URL;
    else process.env.CF_TRANSCRIPT_WORKER_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.CF_TRANSCRIPT_WORKER_SECRET;
    else process.env.CF_TRANSCRIPT_WORKER_SECRET = originalSecret;
  }
});

test('synthesizeVoiceFeedback falls back to OpenAI for unsupported Cloudflare languages', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.CF_TRANSCRIPT_WORKER_URL;
  const originalSecret = process.env.CF_TRANSCRIPT_WORKER_SECRET;
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.CF_TRANSCRIPT_WORKER_URL = 'https://worker.example.test/transcripts';
  process.env.CF_TRANSCRIPT_WORKER_SECRET = 'test-secret';
  process.env.OPENAI_API_KEY = 'openai-test-key';
  let callCount = 0;

  globalThis.fetch = async (url, options) => {
    callCount += 1;
    if (callCount === 1) {
      assert.equal(String(url), 'https://worker.example.test/transcripts?action=tts');
      return new Response('Unsupported language', { status: 422 });
    }

    assert.equal(url, 'https://api.openai.com/v1/audio/speech');
    assert.equal(options.headers.Authorization, 'Bearer openai-test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.input, 'Bonjour');
    assert.match(body.instructions, /fr-FR/);
    return new Response(Uint8Array.from([4, 5, 6]), { status: 200 });
  };

  try {
    const result = await synthesizeVoiceFeedback({ text: 'Bonjour', languageCode: 'fr-FR' });
    assert.deepEqual([...result.audioBuffer], [4, 5, 6]);
    assert.equal(result.usedFallback, true);
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.CF_TRANSCRIPT_WORKER_URL;
    else process.env.CF_TRANSCRIPT_WORKER_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.CF_TRANSCRIPT_WORKER_SECRET;
    else process.env.CF_TRANSCRIPT_WORKER_SECRET = originalSecret;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});
