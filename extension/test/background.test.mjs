import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('context menu installation is serialized across lifecycle events', async () => {
  const source = await readFile(new URL('../background.js', import.meta.url), 'utf8');
  const installedListeners = [];
  const startupListeners = [];
  const menuIds = new Set();
  const warnings = [];
  let lastError;
  let createCount = 0;

  const event = (listeners) => ({ addListener: (listener) => listeners.push(listener) });
  const chrome = {
    contextMenus: {
      onClicked: event([]),
      removeAll(callback) {
        setTimeout(() => {
          menuIds.clear();
          lastError = undefined;
          callback();
          lastError = undefined;
        }, 0);
      },
      create(options, callback) {
        setTimeout(() => {
          createCount += 1;
          lastError = menuIds.has(options.id)
            ? { message: `Cannot create item with duplicate id ${options.id}` }
            : undefined;
          menuIds.add(options.id);
          callback();
          lastError = undefined;
        }, 0);
      },
    },
    runtime: {
      get lastError() { return lastError; },
      onInstalled: event(installedListeners),
      onStartup: event(startupListeners),
      onMessage: event([]),
    },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    tabs: { query: async () => [], sendMessage: async () => {}, create: async () => {} },
  };

  vm.runInNewContext(source, {
    chrome,
    console: { ...console, warn: (...args) => warnings.push(args.join(' ')) },
    crypto,
    fetch,
    URLSearchParams,
    Intl,
    Date,
    setTimeout,
    clearTimeout,
  });

  assert.equal(installedListeners.length, 1);
  assert.equal(startupListeners.length, 1);
  await Promise.all([installedListeners[0](), startupListeners[0]()]);

  assert.equal(createCount, 1);
  assert.deepEqual([...menuIds], ['polycast-lookup-selection']);
  assert.deepEqual(warnings, []);
});
