import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('context menu installation is serialized across lifecycle events', async () => {
  const generated = await readFile(new URL('../generated/messageContract.js', import.meta.url), 'utf8');
  const router = await readFile(new URL('../background/messageRouter.js', import.meta.url), 'utf8');
  const activation = await readFile(new URL('../background/activation.js', import.meta.url), 'utf8');
  const source = `${generated}\n${router}\n${activation}\n${await readFile(new URL('../background.js', import.meta.url), 'utf8')}`;
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
      id: 'polycast-test-extension',
      get lastError() { return lastError; },
      onInstalled: event(installedListeners),
      onStartup: event(startupListeners),
      onMessage: event([]),
    },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    tabs: { query: async () => [], sendMessage: async () => {}, create: async () => {} },
    scripting: { getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => {} },
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
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(createCount, 1);
  assert.deepEqual([...menuIds], ['polycast-lookup-selection']);
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.buildDailyGoalSnapshot(5, 6))),
    { goal: 5, added: 6, remaining: 0, complete: true, overGoal: 1, bonusXp: 0 },
  );
  assert.throws(
    () => context.validateRuntimeMessage({ type: 'LOGIN', username: 'u', password: 'p' }, { tab: { id: 1 } }),
    /only accepted from the extension popup/,
  );
  assert.throws(
    () => context.validateRuntimeMessage({ type: 'MATCH_PAGE_TOKENS', tokens: Array(1501).fill('word') }),
    /at most 1500 entries/,
  );
  assert.throws(
    () => context.validateRuntimeMessage({ type: 'NOT_A_REAL_MESSAGE' }),
    /Unknown extension message type/,
  );
  assert.throws(
    () => context.validateRuntimeMessage({ type: 'GET_STATUS' }, { id: 'different-extension' }),
    /sender is not this extension/,
  );
  const apiFixtures = JSON.parse(await readFile(new URL('../../contracts/api-v1.fixtures.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => context.validateRuntimeMessage(apiFixtures.extensionMessage));
});

test('large saved dictionaries are indexed once and page matching stays bounded', async () => {
  const generated = await readFile(new URL('../generated/messageContract.js', import.meta.url), 'utf8');
  const router = await readFile(new URL('../background/messageRouter.js', import.meta.url), 'utf8');
  const activation = await readFile(new URL('../background/activation.js', import.meta.url), 'utf8');
  const source = `${generated}\n${router}\n${activation}\n${await readFile(new URL('../background.js', import.meta.url), 'utf8')}`;
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

test('page broadcasts target only built-in subtitle content scripts', async () => {
  const generated = await readFile(new URL('../generated/messageContract.js', import.meta.url), 'utf8');
  const router = await readFile(new URL('../background/messageRouter.js', import.meta.url), 'utf8');
  const activation = await readFile(new URL('../background/activation.js', import.meta.url), 'utf8');
  const source = `${generated}\n${router}\n${activation}\n${await readFile(new URL('../background.js', import.meta.url), 'utf8')}`;
  const queried = [];
  const tabMessages = [];
  const event = () => ({ addListener: () => {} });
  const stored = { siteContentScriptIds: { 'https://learn.example.test': 'polycast-site-test' } };
  const chrome = {
    contextMenus: { onClicked: event(), removeAll: (cb) => cb(), create: (_opts, cb) => cb() },
    runtime: { id: 'polycast-test-extension', lastError: undefined, onInstalled: event(), onStartup: event(), onMessage: event() },
    storage: { local: {
      async get(key) { return key in stored ? { [key]: stored[key] } : {}; },
      async set(values) { Object.assign(stored, values); },
      async remove() {},
    } },
    tabs: {
      async query(options) {
        queried.push(options);
        return [{ id: 7, url: 'https://www.youtube.com/watch?v=test' }];
      },
      async sendMessage(tabId, message) { tabMessages.push({ tabId, message }); },
      async create() {},
    },
  };
  const context = {
    chrome, console, crypto, fetch, URLSearchParams, Intl, Date, setTimeout, clearTimeout, Map, Set,
  };
  vm.runInNewContext(source, context);

  await context.broadcastDailyGoalUpdated(context.buildDailyGoalSnapshot(5, 2));

  assert.deepEqual(JSON.parse(JSON.stringify(queried)), [{
    url: ['*://*.youtube.com/*', 'https://*.netflix.com/*'],
  }]);
  assert.equal(tabMessages.length, 1);
  assert.equal(tabMessages[0].message.type, 'DAILY_GOAL_UPDATED');
});

test('an authenticated 401 clears account state and broadcasts one detailed expiration diagnostic', async () => {
  const generated = await readFile(new URL('../generated/messageContract.js', import.meta.url), 'utf8');
  const router = await readFile(new URL('../background/messageRouter.js', import.meta.url), 'utf8');
  const activation = await readFile(new URL('../background/activation.js', import.meta.url), 'utf8');
  const source = `${generated}\n${router}\n${activation}\n${await readFile(new URL('../background.js', import.meta.url), 'utf8')}`;
  const stored = {
    authToken: 'expired-token', user: { id: 'user-1' }, savedWords: ['hola'],
    wildRecallCatalog: [{ id: 'word-1' }], wildRecallChallenge: { id: 'challenge-1' },
    progression: { totalXp: 12 },
  };
  const tabMessages = [];
  const diagnostics = [];
  const event = () => ({ addListener: () => {} });
  const chrome = {
    contextMenus: { onClicked: event(), removeAll: (cb) => cb(), create: (_opts, cb) => cb() },
    runtime: { id: 'polycast-test-extension', lastError: undefined, onInstalled: event(), onStartup: event(), onMessage: event() },
    storage: { local: {
      async get(keys) {
        const names = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(names.filter((key) => key in stored).map((key) => [key, stored[key]]));
      },
      async set(values) { Object.assign(stored, values); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
    } },
    tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: async (tabId, message) => { tabMessages.push({ tabId, message }); },
      create: async () => {},
    },
  };
  const context = {
    chrome,
    console: { ...console, info: (...args) => diagnostics.push(args) },
    crypto,
    fetch: async () => new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    }),
    URLSearchParams, Intl, Date, setTimeout, clearTimeout, Map, Set,
  };
  vm.runInNewContext(source, context);

  const results = await Promise.allSettled([
    context.apiFetch('/api/me'), context.apiFetch('/api/dictionary/words'),
  ]);
  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.equal(stored.authToken, undefined);
  assert.equal(stored.user, undefined);
  assert.equal(stored.wildRecallCatalog, undefined);
  const notices = tabMessages.filter(({ message }) => message.type === 'POLYCAST_FALLBACK_NOTICE');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].message.diagnostic.code, 'extension_session_expired');
  assert.equal(notices[0].message.diagnostic.severity, 'error');
  assert.match(notices[0].message.diagnostic.detail, /status=401; path=\/api\//);
  assert.ok(notices[0].message.diagnostic.correlationId);
  assert.equal(diagnostics.filter((args) => args[0] === '[polycast:fallback]').length, 1);
});
