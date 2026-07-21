import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('app bridge syncs dictionary data without forcing the web app offline', async () => {
  const source = await readFile(new URL('../content/app-bridge.js', import.meta.url), 'utf8');
  const writes = [];
  const removals = [];
  const dispatched = [];
  const windowListeners = new Map();
  const runtimeListeners = [];

  const context = {
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (_message, callback) => callback?.({ words: [{ word: 'weather' }] }),
        onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
      },
    },
    localStorage: {
      setItem: (key, value) => writes.push([key, value]),
      removeItem: (key) => removals.push(key),
    },
    window: {
      addEventListener: (name, listener) => windowListeners.set(name, listener),
      dispatchEvent: (event) => dispatched.push(event.type),
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    console,
    crypto,
    Date,
  };

  vm.runInNewContext(source, context);

  assert.deepEqual(writes, [[
    'polycast.offline.dictionary.words.v1',
    JSON.stringify([{ word: 'weather' }]),
  ]]);
  assert.equal(writes.some(([key]) => key === 'polycast.offline.enabled'), false);
  assert.deepEqual(removals, ['polycast.offline.enabled']);
  assert.deepEqual(dispatched, ['polycast-offline-dictionary-external-sync']);
  assert.equal(runtimeListeners.length, 1);
  assert.equal(windowListeners.has('polycast-offline-dictionary-updated'), true);
});

test('app bridge runs before the web app can consume a legacy offline flag', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const bridge = manifest.content_scripts.find((entry) => entry.js.includes('content/app-bridge.js'));

  assert.ok(bridge);
  assert.equal(bridge.run_at, 'document_start');
});
