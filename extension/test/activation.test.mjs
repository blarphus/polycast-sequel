import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadBackground({ permitted = true, sendMessage = async () => undefined } = {}) {
  const generated = await readFile(new URL('../generated/messageContract.js', import.meta.url), 'utf8');
  const router = await readFile(new URL('../background/messageRouter.js', import.meta.url), 'utf8');
  const activation = await readFile(new URL('../background/activation.js', import.meta.url), 'utf8');
  const source = `${generated}\n${router}\n${activation}\n${await readFile(new URL('../background.js', import.meta.url), 'utf8')}`;
  const storage = {};
  const registered = new Map();
  const executed = [];
  const insertedCss = [];
  const unregistered = [];
  const contextMenuListeners = [];
  const event = () => ({ addListener() {} });
  const chrome = {
    runtime: { id: 'extension-id', lastError: undefined, onInstalled: event(), onStartup: event(), onMessage: event() },
    contextMenus: {
      onClicked: { addListener: (listener) => contextMenuListeners.push(listener) },
      removeAll: (callback) => callback(),
      create: (_options, callback) => callback(),
    },
    storage: { local: {
      async get(keys) {
        const names = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(names.filter((key) => key in storage).map((key) => [key, storage[key]]));
      },
      async set(values) { Object.assign(storage, values); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; },
    } },
    tabs: { query: async () => [], sendMessage, create: async () => {} },
    permissions: { contains: async () => permitted },
    scripting: {
      async getRegisteredContentScripts({ ids }) { return ids.map((id) => registered.get(id)).filter(Boolean); },
      async registerContentScripts(entries) { for (const entry of entries) registered.set(entry.id, entry); },
      async unregisterContentScripts({ ids }) { for (const id of ids) { registered.delete(id); unregistered.push(id); } },
      async executeScript(options) { executed.push(options); },
      async insertCSS(options) { insertedCss.push(options); },
    },
  };
  const context = { chrome, console, crypto, fetch, URL, URLSearchParams, Intl, Date, setTimeout, clearTimeout, Map, Set };
  vm.runInNewContext(source, context);
  return { context, registered, executed, insertedCss, unregistered, contextMenuListeners, storage };
}

test('ordinary-site activation is exact-origin, user-permitted, persistent, and non-duplicating', async () => {
  const fixture = await loadBackground();
  const request = { pageUrl: 'https://learn.example.test/article?id=1', hostname: 'learn.example.test', tabId: 42 };
  const first = await fixture.context.activateOptionalSite(request);

  assert.equal(first.origin, 'https://learn.example.test');
  assert.equal(first.pattern, 'https://learn.example.test/*');
  assert.equal(fixture.registered.size, 1);
  const registration = [...fixture.registered.values()][0];
  assert.equal(registration.matches[0], 'https://learn.example.test/*');
  assert.equal(registration.persistAcrossSessions, true);
  assert.equal(fixture.executed.length, 1);
  assert.equal(fixture.insertedCss.length, 1);

  await fixture.context.activateOptionalSite(request);
  assert.equal(fixture.registered.size, 1);
  assert.equal(fixture.executed.length, 1, 'repeat activation must not install a second listener set');

  await fixture.context.deactivateOptionalSite(request.pageUrl, request.hostname);
  assert.equal(fixture.registered.size, 0);
  assert.deepEqual(fixture.unregistered, [first.id]);
});

test('right-click lookup injects a one-time runtime when an ordinary page has no listener', async () => {
  let sends = 0;
  const fixture = await loadBackground({
    sendMessage: async () => {
      sends += 1;
      if (sends === 1) throw new Error('Receiving end does not exist');
      if (sends === 2) return { success: true, shellLatencyMs: 8 };
      return undefined;
    },
  });

  assert.equal(fixture.contextMenuListeners.length, 1);
  fixture.contextMenuListeners[0]({
    menuItemId: 'polycast-lookup-selection',
    selectionText: 'teacher',
    frameId: 0,
  }, { id: 42 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(fixture.insertedCss.length, 1);
  assert.deepEqual(Array.from(fixture.insertedCss[0].target.frameIds), [0]);
  assert.equal(fixture.executed.length, 1);
  assert.ok(fixture.executed[0].files.includes('content/selection.js'));
  assert.equal(fixture.storage.lastFallbackDiagnostic.code, 'selection_runtime_injected');
});

test('right-click lookup keeps listener rejections visible without reinjecting scripts', async () => {
  const fixture = await loadBackground({
    sendMessage: async () => ({ success: false, error: 'Select one word' }),
  });

  fixture.contextMenuListeners[0]({
    menuItemId: 'polycast-lookup-selection',
    selectionText: 'two words',
    frameId: 0,
  }, { id: 42 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(fixture.executed.length, 0);
  assert.equal(fixture.storage.lastFallbackDiagnostic.code, 'selection_popup_not_opened');
});

test('an injected listener rejection does not add a misleading unavailable notice', async () => {
  let sends = 0;
  const fixture = await loadBackground({
    sendMessage: async () => {
      sends += 1;
      if (sends === 1) throw new Error('Receiving end does not exist');
      return { success: false, error: 'Select one word' };
    },
  });

  fixture.contextMenuListeners[0]({
    menuItemId: 'polycast-lookup-selection',
    selectionText: 'two words',
    frameId: 0,
  }, { id: 42 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(fixture.executed.length, 1, 'only the runtime bundle should be injected');
  assert.equal(fixture.storage.lastFallbackDiagnostic.code, 'selection_popup_not_opened');
});

test('ordinary-site activation fails visibly when optional permission is absent', async () => {
  const fixture = await loadBackground({ permitted: false });
  await assert.rejects(
    fixture.context.activateOptionalSite({ pageUrl: 'https://example.test/page', hostname: 'example.test', tabId: 1 }),
    /Permission for https:\/\/example\.test has not been granted/,
  );
  assert.equal(fixture.registered.size, 0);
  assert.equal(fixture.executed.length, 0);
});
