import assert from 'node:assert/strict';
import test from 'node:test';
import { createDictionaryMediaService } from './dictionaryMediaService.js';

test('dictionary media proxy returns owned bytes and content type', async () => {
  const service = createDictionaryMediaService({
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/webp' },
    }),
  });
  const image = await service.proxyImage('https://pixabay.com/photo.webp');
  assert.equal(image.contentType, 'image/webp');
  assert.deepEqual([...image.data], [1, 2, 3]);
});

test('dictionary media proxy converts network failures into typed upstream errors', async () => {
  const service = createDictionaryMediaService({
    fetchImpl: async () => { throw new Error('network detail'); },
  });
  await assert.rejects(
    () => service.proxyImage('https://pixabay.com/photo.webp'),
    (error) => error.status === 502 && error.code === 'image_proxy_unreachable',
  );
});

test('dictionary word audio reports and caches an alternate voice path', async () => {
  const calls = [];
  const db = {
    async query(text, values) {
      calls.push({ text, values });
      if (calls.length === 1) return { rows: [{ word: 'bonjour', target_language: 'fr', tts_audio: null }] };
      return { rowCount: 1 };
    },
  };
  const service = createDictionaryMediaService({
    db,
    synthesize: async () => ({ audioBuffer: Buffer.from('audio'), usedFallback: true }),
  });
  const audio = await service.wordAudio('user-1', 'word-1');
  assert.equal(audio.usedFallback, true);
  assert.equal(audio.source, 'generated');
  assert.equal(audio.languageCode, 'fr');
  assert.equal(calls.length, 2);
});

test('cached alternate-language audio remains visibly classified as fallback', async () => {
  const service = createDictionaryMediaService({
    db: { query: async () => ({ rows: [{ word: 'bonjour', target_language: 'fr', tts_audio: Buffer.from('cached') }] }) },
  });
  const audio = await service.wordAudio('user-1', 'word-1');
  assert.equal(audio.usedFallback, true);
  assert.equal(audio.source, 'cache');
});
