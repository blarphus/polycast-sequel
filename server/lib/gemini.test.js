import assert from 'node:assert/strict';
import test from 'node:test';

import {
  callGemini,
  callGeminiRoutine,
  callGeminiVision,
  streamGemini,
  GEMINI_GENERAL_MODEL,
  GEMINI_DICTIONARY_MODEL,
  GEMINI_DICTIONARY_THINKING_LEVEL,
  GEMINI_FLASH_LITE_MODEL,
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

test('callGeminiRoutine uses Flash-Lite and accepts a locally valid first response', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'valid output' }] } }],
    }), { status: 200 });
  };

  try {
    const result = await callGeminiRoutine('routine prompt', {
      validate: (text) => text === 'valid output',
    });
    assert.equal(result.text, 'valid output');
    assert.equal(result.model, GEMINI_FLASH_LITE_MODEL);
    assert.equal(result.attempts, 1);
    assert.deepEqual(result.fallbackNotices, []);
    assert.match(request.url, new RegExp(`/models/${GEMINI_FLASH_LITE_MODEL}:generateContent$`));
    assert.deepEqual(request.body.generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('callGeminiRoutine retries invalid Lite output before accepting it', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  const prompts = [];
  globalThis.fetch = async (_url, options) => {
    prompts.push(JSON.parse(options.body).contents[0].parts[0].text);
    const text = prompts.length === 1 ? 'invalid' : 'valid';
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
    }), { status: 200 });
  };

  try {
    const result = await callGeminiRoutine('routine prompt', {
      validate: (text) => text === 'valid',
    });
    assert.equal(result.attempts, 2);
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /previous response was invalid/i);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('callGeminiRoutine visibly diagnoses a stronger-model escalation', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const text = requests.length < 3 ? 'invalid' : 'valid';
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
    }), { status: 200 });
  };
  const notices = [];

  try {
    const result = await callGeminiRoutine('routine prompt', {
      validate: (text) => text === 'valid',
      onFallback: (diagnostic) => notices.push(diagnostic),
      task: 'test output',
    });
    assert.equal(requests.length, 3);
    assert.equal(result.model, GEMINI_GENERAL_MODEL);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].code, 'gemini_flash_lite_escalation_used');
    assert.match(notices[0].message, /Gemini 3\.6 Flash/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('callGeminiRoutine refuses to escalate silently', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'invalid' }] } }],
    }), { status: 200 });
  };

  try {
    await assert.rejects(
      () => callGeminiRoutine('routine prompt', { validate: () => false }),
      /refusing a silent stronger-model fallback/,
    );
    assert.equal(calls, 2);
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
