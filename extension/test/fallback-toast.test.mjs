import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('fallback toast renders hostile diagnostic fields as text, never HTML', async () => {
  const tokens = await readFile(new URL('../shared/textTokens.js', import.meta.url), 'utf8');
  const source = `${tokens}\n${await readFile(new URL('../content/shared.js', import.meta.url), 'utf8')}`;
  const appended = [];
  let innerHtmlWrites = 0;

  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.textContent = '';
      this.className = '';
    }
    set innerHTML(_value) { innerHtmlWrites += 1; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); }
    setAttribute() {}
    remove() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
  }

  const listeners = [];
  const context = {
    chrome: {
      runtime: {
        sendMessage: async () => ({}),
        onMessage: { addListener: (listener) => listeners.push(listener) },
      },
    },
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => new Element(tag),
      body: { appendChild: (node) => appended.push(node) },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    window: {},
    console,
    Intl,
    Set,
    Map,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  vm.runInNewContext(source, context);

  const payload = '<img src=x onerror="globalThis.pwned=true"><svg onload="pwned=true">';
  context.showFallbackToast(payload, payload);

  assert.equal(appended.length, 1);
  assert.equal(innerHtmlWrites, 0);
  assert.equal(appended[0].children[0].textContent, payload);
  assert.equal(appended[0].children[1].textContent, payload);
  assert.equal(context.pwned, undefined);
});
