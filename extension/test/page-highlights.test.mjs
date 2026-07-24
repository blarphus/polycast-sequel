import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const [tokenSource, highlightSource] = await Promise.all([
  readFile(new URL('../shared/textTokens.js', import.meta.url), 'utf8'),
  readFile(new URL('../content/pageHighlights.js', import.meta.url), 'utf8'),
]);

function makePage({
  html = '<main><p>Siempre he tenido miedo a morir, pero quiero vivir.</p></main>',
  targetLanguage = 'es',
  detection = { isReliable: true, languages: [{ language: 'es', percentage: 96 }] },
  matches = ['morir'],
} = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'https://example.test/story',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const popupCalls = [];
  const remembered = [];
  const messages = [];
  const listeners = [];
  dom.window.__POLYCAST_PAGE_HIGHLIGHTS_TEST__ = true;
  dom.window.PolycastContent = {
    openWordPopup: (options) => popupCalls.push(options),
    rememberSavedTokens: (tokens) => remembered.push(...tokens),
    setTargetLanguage: () => {},
    showFallbackToast: () => {},
  };
  dom.window.chrome = {
    i18n: {
      detectLanguage(_text, callback) {
        callback(detection);
      },
    },
    runtime: {
      lastError: undefined,
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'GET_TARGET_LANGUAGE') return { targetLanguage };
        if (message.type === 'MATCH_PAGE_TOKENS') {
          return {
            matches: message.tokens
              .filter((token) => matches.includes(token))
              .map((token) => ({ token })),
          };
        }
        return {};
      },
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
  };
  dom.window.eval(tokenSource);
  dom.window.eval(highlightSource);
  return {
    dom,
    popupCalls,
    remembered,
    messages,
    listeners,
    api: dom.window.PolycastPageHighlights,
  };
}

test('Chrome-primary target-language pages highlight saved words and open the shared anchored popup', async () => {
  const fixture = makePage();
  await fixture.api.boot();

  const mark = fixture.dom.window.document.querySelector('.pc-page-saved-word');
  assert.ok(mark);
  assert.equal(mark.textContent, 'morir');
  assert.ok(mark.classList.contains('pc-word'));
  assert.ok(mark.classList.contains('pc-saved'));
  assert.deepEqual(fixture.remembered, ['morir']);
  assert.ok(fixture.messages.some((message) => message.type === 'MATCH_PAGE_TOKENS'));

  mark.click();
  assert.equal(fixture.popupCalls.length, 1);
  assert.equal(fixture.popupCalls[0].word, 'morir');
  assert.match(fixture.popupCalls[0].sentence, /miedo a morir/);
  assert.ok(fixture.popupCalls[0].anchorRect);
});

test('Chrome-primary non-target and unreliable pages remain untouched', async () => {
  for (const detection of [
    { isReliable: true, languages: [{ language: 'en', percentage: 91 }, { language: 'es', percentage: 9 }] },
    { isReliable: false, languages: [{ language: 'es', percentage: 99 }] },
    { isReliable: true, languages: [{ language: 'es', percentage: 49 }, { language: 'en', percentage: 51 }] },
    { isReliable: true, languages: [{ language: 'es', percentage: 50 }, { language: 'en', percentage: 50 }] },
  ]) {
    const fixture = makePage({ detection });
    await fixture.api.boot();
    assert.equal(fixture.dom.window.document.querySelector('.pc-page-saved-word'), null);
    assert.equal(
      fixture.messages.filter((message) => message.type === 'MATCH_PAGE_TOKENS').length,
      0,
    );
  }
});

test('language comparison normalizes regional Chrome and profile codes', () => {
  const fixture = makePage();
  assert.equal(fixture.api.isPrimaryTargetLanguage({
    isReliable: true,
    languages: [{ language: 'es-MX', percentage: 88 }],
  }, 'es_ES'), true);
  assert.equal(fixture.api.isPrimaryTargetLanguage({
    isReliable: true,
    languages: [{ language: 'pt-BR', percentage: 88 }],
  }, 'es'), false);
});

test('page highlighting leaves form controls and code samples unchanged', async () => {
  const fixture = makePage({
    html: '<p>Quiero morir.</p><button>morir</button><code>morir</code><textarea>morir</textarea>',
  });
  await fixture.api.boot();

  assert.equal(fixture.dom.window.document.querySelectorAll('.pc-page-saved-word').length, 1);
  assert.equal(fixture.dom.window.document.querySelector('button').textContent, 'morir');
  assert.equal(fixture.dom.window.document.querySelector('code').textContent, 'morir');
  assert.equal(fixture.dom.window.document.querySelector('textarea').value, 'morir');
});
