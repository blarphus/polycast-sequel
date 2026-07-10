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

  const context = {
    chrome,
    console: { ...console, warn: (...args) => warnings.push(args.join(' ')) },
    crypto,
    fetch,
    URLSearchParams,
    Intl,
    Date,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context);

  assert.equal(installedListeners.length, 1);
  assert.equal(startupListeners.length, 1);
  await Promise.all([installedListeners[0](), startupListeners[0]()]);

  assert.equal(createCount, 1);
  assert.deepEqual([...menuIds], ['polycast-lookup-selection']);
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.buildDailyGoalSnapshot(5, 6))),
    { goal: 5, added: 6, remaining: 0, complete: true, overGoal: 1, bonusXp: 0 },
  );
});

test('large saved dictionaries are indexed once and page matching stays bounded', async () => {
  const source = await readFile(new URL('../background.js', import.meta.url), 'utf8');
  const event = () => ({ addListener: () => {} });
  const chrome = {
    contextMenus: { onClicked: event(), removeAll: (cb) => cb(), create: (_opts, cb) => cb() },
    runtime: { lastError: undefined, onInstalled: event(), onStartup: event(), onMessage: event() },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    tabs: { query: async () => [], sendMessage: async () => {}, create: async () => {}, detectLanguage: async () => 'es' },
    i18n: { detectLanguage: async () => ({ isReliable: true, languages: [{ language: 'es', percentage: 99 }] }) },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  const context = { chrome, console, crypto, fetch, URLSearchParams, Intl, Date, setTimeout, clearTimeout, Map, Set };
  vm.runInNewContext(source, context);
  const words = Array.from({ length: 25000 }, (_, index) => ({
    id: crypto.randomUUID(),
    word: `palabra${index}`,
    lemma: `lema${index}`,
    forms: JSON.stringify([`forma${index}`]),
    last_reviewed_at: index % 4 === 0 ? new Date().toISOString() : null,
  }));
  const heapBeforeIndex = process.memoryUsage().heapUsed;
  const started = performance.now();
  context.rebuildSavedTokenIndex(words);
  const indexMs = performance.now() - started;
  const heapDeltaMb = (process.memoryUsage().heapUsed - heapBeforeIndex) / (1024 * 1024);
  const tokens = Array.from({ length: 1200 }, (_, index) => index % 2 ? `missing${index}` : `palabra${index}`);
  const matchStarted = performance.now();
  const result = await context.handleMessage({ type: 'MATCH_PAGE_TOKENS', tokens });
  const matchMs = performance.now() - matchStarted;
  console.info(`extension-perf index=${indexMs.toFixed(1)}ms match=${matchMs.toFixed(2)}ms heapDelta=${heapDeltaMb.toFixed(1)}MB`);
  assert.equal(result.matches.length, 600);
  assert.ok(indexMs < 750, `25k-word index took ${indexMs.toFixed(1)}ms`);
  assert.ok(matchMs < 50, `1200-token match took ${matchMs.toFixed(1)}ms`);
});
