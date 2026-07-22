import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../shared/wordPopupCore.js', import.meta.url), 'utf8');

function makeDom({ width = 1200, height = 800 } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: height });
  let resizeCallback;
  dom.window.ResizeObserver = class {
    constructor(callback) { resizeCallback = callback; }
    observe() {}
    disconnect() {}
  };
  dom.window.eval(source);
  return { dom, resize: () => resizeCallback?.() };
}

test('popup keeps its above-anchor placement while async content expands', async () => {
  const { dom, resize } = makeDom();
  let resolveLookup;
  const popup = dom.window.PolycastWordPopup.createWordPopup({
    word: 'troubled',
    sentence: "There's been a horde of you.",
    anchorRect: { left: 500, right: 570, top: 700, bottom: 725, width: 70, height: 25 },
    handlers: { lookup: () => new Promise((resolve) => { resolveLookup = resolve; }) },
  });

  assert.equal(popup.el.dataset.placement, 'above');
  const loadingBottom = popup.el.style.bottom;
  assert.equal(popup.el.style.top, '');

  resolveLookup({ valid: true, translation: 'agitar', definition: 'Alterar o perturbar.', part_of_speech: 'verb' });
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  resize();

  assert.equal(popup.el.dataset.placement, 'above');
  assert.equal(popup.el.style.bottom, loadingBottom);
  assert.equal(popup.el.style.top, '');
  popup.destroy();
});

test('popup keeps its below-anchor placement while async content expands', async () => {
  const { dom, resize } = makeDom();
  let resolveLookup;
  const popup = dom.window.PolycastWordPopup.createWordPopup({
    word: 'titular',
    sentence: 'El titular cambió esta mañana.',
    anchorRect: { left: 300, right: 350, top: 40, bottom: 65, width: 50, height: 25 },
    handlers: { lookup: () => new Promise((resolve) => { resolveLookup = resolve; }) },
  });

  assert.equal(popup.el.dataset.placement, 'below');
  const loadingTop = popup.el.style.top;

  resolveLookup({ valid: true, translation: 'headline', definition: 'The title of a news story.', part_of_speech: 'noun' });
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  resize();

  assert.equal(popup.el.dataset.placement, 'below');
  assert.equal(popup.el.style.top, loadingTop);
  assert.equal(popup.el.style.bottom, '');
  popup.destroy();
});
