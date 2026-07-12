import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadBackground({ permitted = true } = {}) {
  const generated = await readFile(new URL('../generated/messageContract.js', import.meta.url), 'utf8');
  const router = await readFile(new URL('../background/messageRouter.js', import.meta.url), 'utf8');
  const activation = await readFile(new URL('../background/activation.js', import.meta.url), 'utf8');
  const source = `${generated}\n${router}\n${activation}\n${await readFile(new URL('../background.js', import.meta.url), 'utf8')}`;
  const storage = {};
  const registered = new Map();
  const executed = [];
  const insertedCss = [];
  const unregistered = [];
  const event = () => ({ addListener() {} });
  const chrome = {
    runtime: { id: 'extension-id', lastError: undefined, onInstalled: event(), onStartup: event(), onMessage: event() },
    contextMenus: { onClicked: event(), removeAll: (callback) => callback(), create: (_options, callback) => callback() },
    storage: { local: {
      async get(keys) {
        const names = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(names.filter((key) => key in storage).map((key) => [key, storage[key]]));
      },
      async set(values) { Object.assign(storage, values); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; },
    } },
    tabs: { query: async () => [], sendMessage: async () => {}, create: async () => {} },
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
  return { context, registered, executed, insertedCss, unregistered };
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

test('ordinary-site activation fails visibly when optional permission is absent', async () => {
  const fixture = await loadBackground({ permitted: false });
  await assert.rejects(
    fixture.context.activateOptionalSite({ pageUrl: 'https://example.test/page', hostname: 'example.test', tabId: 1 }),
    /Permission for https:\/\/example\.test has not been granted/,
  );
  assert.equal(fixture.registered.size, 0);
  assert.equal(fixture.executed.length, 0);
});
