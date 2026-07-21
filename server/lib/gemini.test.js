import assert from 'node:assert/strict';
import test from 'node:test';

import {
  callGemini,
  callGeminiVision,
  streamGemini,
  GEMINI_GENERAL_MODEL,
  GEMINI_DICTIONARY_MODEL,
  GEMINI_DICTIONARY_THINKING_LEVEL,
} from './gemini.js';

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

test('callGemini pins general requests to Gemini 3.6 Flash at low thinking', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    }), { status: 200 });
  };

  try {
    assert.equal(await callGemini('test prompt'), 'ok');
    assert.match(request.url, new RegExp(`/models/${GEMINI_GENERAL_MODEL}:generateContent$`));
    assert.deepEqual(request.body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('callGemini supports pinned dictionary requests at minimal thinking', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    }), { status: 200 });
  };

  try {
    assert.equal(await callGemini(
      'dictionary prompt',
      { thinkingConfig: { thinkingLevel: GEMINI_DICTIONARY_THINKING_LEVEL } },
      GEMINI_DICTIONARY_MODEL,
    ), 'ok');
    assert.match(request.url, new RegExp(`/models/${GEMINI_DICTIONARY_MODEL}:generateContent$`));
    assert.deepEqual(request.body.generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('Gemini clients reject legacy numeric thinking budgets before making a request', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('fetch should not run');
  };

  try {
    await assert.rejects(
      () => callGemini('test', { thinkingConfig: { thinkingBudget: 0 } }),
      /thinkingBudget is unsupported/,
    );
    await assert.rejects(
      () => callGeminiVision([{ text: 'test' }], { thinkingConfig: { thinkingBudget: 0 } }),
      /thinkingBudget is unsupported/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('streamGemini pins Gemini 3.6 Flash and injects low thinking', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return new Response('data: {"candidates":[{"content":{"parts":[{"text":"streamed"}]}}]}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  try {
    assert.equal(await streamGemini('test prompt'), 'streamed');
    assert.match(request.url, new RegExp(`/models/${GEMINI_GENERAL_MODEL}:streamGenerateContent\\?alt=sse$`));
    assert.deepEqual(request.body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
