import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../content/pageHighlights.js', import.meta.url), 'utf8');
const messageContract = JSON.parse(await readFile(new URL('../../contracts/extension-messages-v1.json', import.meta.url), 'utf8'));

test('page highlights bypass page-language detection and validate language on click', () => {
  assert.match(source, /enabled = override !== 'off'/);
  assert.match(source, /validationMode: 'click-context'/);
  assert.doesNotMatch(source, /DETECT_PAGE_LANGUAGE/);
  assert.equal(messageContract.messages.DETECT_PAGE_LANGUAGE, undefined);
});

test('random shimmering Wild Recall page cues remain explicitly paused', () => {
  assert.match(source, /const WILD_RECALL_PAGE_CUES_ENABLED = false/);
  assert.match(source, /if \(!WILD_RECALL_PAGE_CUES_ENABLED \|\| !recallSampledForPage/);
  assert.match(source, /WILD_RECALL_PAGE_CUES_ENABLED && recallChallenge/);
});

test('async highlight refreshes handle extension reload invalidation without uncaught promises', () => {
  assert.match(source, /function isExtensionContextInvalidated\(error\)/);
  assert.match(source, /code: 'extension_context_invalidated'/);
  assert.match(source, /selectedAction: 'stop-stale-content-script'/);
  assert.match(source, /resolveHighlightState\(forcedOverride\)\.catch\(\(error\) =>/);
  assert.match(source, /if \(msg\.type === 'WORDS_UPDATED'\) refreshHighlightState/);
  assert.match(source, /SITE_HIGHLIGHT_OVERRIDE_UPDATED'\) refreshHighlightState/);
  assert.doesNotMatch(source, /if \(msg\.type === 'WORDS_UPDATED'\) void resolveHighlightState/);
  assert.doesNotMatch(source, /console\.warn\(/);
});

test('a rejected runtime call stops the stale highlighter and emits one visible diagnostic', async () => {
  const diagnostics = [];
  const messageListeners = [];
  let sendCount = 0;
  const context = {
    chrome: {
      runtime: {
        async sendMessage() {
          sendCount += 1;
          throw new Error('Extension context invalidated.');
        },
        onMessage: { addListener: (listener) => messageListeners.push(listener) },
      },
    },
    document: {
      documentElement: { dataset: {} },
      body: {},
      hidden: false,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    window: { addEventListener: () => {}, setTimeout: () => 1 },
    location: { hostname: 'www.youtube.com' },
    performance,
    console,
    globalThis: null,
  };
  context.globalThis = context;
  context.PolycastContent = {
    showFallbackToast: (title, message, diagnostic) => diagnostics.push({ title, message, diagnostic }),
  };

  vm.runInNewContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sendCount, 1);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].diagnostic.code, 'extension_context_invalidated');
  assert.equal(diagnostics[0].diagnostic.selectedAction, 'stop-stale-content-script');
  assert.match(diagnostics[0].message, /Refresh the page once/);

  messageListeners[0]({ type: 'WORDS_UPDATED' }, {}, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sendCount, 1, 'stale tasks must remain stopped after invalidation');
});
