import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from '../../client/node_modules/jsdom/lib/api.js';

test('word popup shell mounts synchronously within the latency budget', async () => {
  const source = await readFile(new URL('../shared/wordPopupCore.js', import.meta.url), 'utf8');
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  dom.window.eval(source);
  const samples = [];
  for (let index = 0; index < 100; index += 1) {
    const started = performance.now();
    const popup = dom.window.PolycastWordPopup.createWordPopup({
      word: 'entorno',
      sentence: 'El entorno cambió.',
      anchorRect: { left: 100, right: 150, top: 100, bottom: 120, width: 50, height: 20 },
      container: dom.window.document.body,
      handlers: { lookup: () => new Promise(() => {}) },
    });
    samples.push(performance.now() - started);
    assert.ok(popup.el.querySelector('.pc-popup-body .pc-spinner'));
    popup.destroy();
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  console.info(`popup-perf p95=${p95.toFixed(2)}ms`);
  assert.ok(p95 < 50, `popup shell p95 was ${p95.toFixed(2)}ms`);
});
