import assert from 'node:assert/strict';
import test from 'node:test';

import { callGemini } from './gemini.js';

test('callGemini retries transient API failures', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), { status: 503 });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'recovered' }] } }],
    }), { status: 200 });
  };

  try {
    assert.equal(await callGemini('test prompt'), 'recovered');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('callGemini does not retry permanent API failures', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'invalid request' } }), { status: 400 });
  };

  try {
    await assert.rejects(() => callGemini('bad prompt'), /Gemini request failed \(400\): invalid request/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
