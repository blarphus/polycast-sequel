import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('selection popup shell opens before lookup content is requested', async () => {
  const source = await readFile(new URL('../content/selection.js', import.meta.url), 'utf8');
  const messageListeners = [];
  const popupCalls = [];
  let preflightLookups = 0;

  const container = {
    nodeType: 1,
    innerText: 'El sospechoso fue abatido durante el operativo.',
    closest: () => container,
  };
  const range = {
    commonAncestorContainer: container,
    toString: () => 'abatido',
    cloneRange() { return this; },
    getBoundingClientRect: () => ({ left: 100, right: 150, top: 200, bottom: 220, width: 50, height: 20 }),
    getClientRects: () => [],
  };
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => 'abatido',
    getRangeAt: () => range,
  };
  const documentElement = { dataset: {} };

  vm.runInNewContext(source, {
    chrome: {
      runtime: {
        onMessage: { addListener: (listener) => messageListeners.push(listener) },
      },
    },
    document: { documentElement, body: container },
    window: { getSelection: () => selection, innerWidth: 1280, innerHeight: 720 },
    Node: { ELEMENT_NODE: 1 },
    PolycastContent: {
      isWordToken: () => true,
      cleanCaptionText: (value) => value,
      openWordPopup: (options) => popupCalls.push(options),
      sendMessageAsync: () => {
        preflightLookups += 1;
        return new Promise(() => {});
      },
    },
    console,
    Date,
  });

  assert.equal(messageListeners.length, 1);
  let response;
  const requestedAt = Date.now();
  const keepChannelOpen = messageListeners[0]({
    type: 'POLYCAST_LOOKUP_SELECTION',
    selectionText: 'abatido',
    requestedAt,
  }, {}, (value) => { response = value; });

  assert.equal(keepChannelOpen, false);
  assert.equal(popupCalls.length, 1);
  assert.equal(popupCalls[0].word, 'abatido');
  assert.equal('initialLookupResult' in popupCalls[0], false);
  assert.equal(preflightLookups, 0);
  assert.equal(response.success, true);
  assert.ok(response.shellLatencyMs >= 0);
});
