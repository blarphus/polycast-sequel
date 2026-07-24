import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../shared/wordPopupCore.js', import.meta.url), 'utf8');

function makeDom() {
  const dom = new JSDOM('<!doctype html><body><span id="word">centenar</span></body>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1200 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 800 });
  dom.window.ResizeObserver = class { observe() {} disconnect() {} };
  const word = dom.window.document.querySelector('#word');
  word.getBoundingClientRect = () => ({
    left: 400, right: 470, top: 700, bottom: 725, width: 70, height: 25,
  });
  dom.window.document.elementFromPoint = () => word;
  dom.window.eval(source);
  return { dom, word };
}

test('popup points to and raises the selected word until destroyed', () => {
  const { dom, word } = makeDom();
  const popup = dom.window.PolycastWordPopup.createWordPopup({
    word: 'centenar',
    sentence: 'Un centenar de pensamientos.',
    anchorRect: word.getBoundingClientRect(),
    handlers: { lookup: () => new Promise(() => {}) },
  });

  const pointer = dom.window.document.querySelector('.pc-popup-pointer');
  assert.ok(pointer);
  assert.equal(pointer.dataset.placement, 'above');
  assert.equal(pointer.style.left, '435px');
  assert.ok(word.classList.contains('pc-popup-anchor-selected'));

  popup.destroy();
  assert.equal(dom.window.document.querySelector('.pc-popup-pointer'), null);
  assert.equal(word.classList.contains('pc-popup-anchor-selected'), false);
});

test('part of speech is in the header and explain controls follow the definition', async () => {
  const { dom, word } = makeDom();
  const popup = dom.window.PolycastWordPopup.createWordPopup({
    word: 'centenar',
    sentence: 'Un centenar de pensamientos.',
    anchorRect: word.getBoundingClientRect(),
    handlers: {
      lookup: () => Promise.resolve({
        valid: true,
        translation: 'hundred',
        definition: 'A group of one hundred people or things.',
        part_of_speech: 'noun',
      }),
      explain: () => Promise.resolve({ explanation: 'Used as a collective quantity.' }),
    },
  });
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  const headerPos = popup.el.querySelector('.pc-popup-header-pos');
  const primary = popup.el.querySelector('.pc-popup-primary');
  const body = popup.el.querySelector('.pc-popup-body');
  const explain = popup.el.querySelector('.pc-popup-explain');
  assert.equal(headerPos.textContent, 'noun');
  assert.equal(headerPos.hidden, false);
  assert.equal(body.querySelector('.pc-popup-pos'), null);
  assert.equal(primary.contains(explain), true);
  assert.equal(body.nextElementSibling.contains(explain), true);
  assert.match(body.textContent, /A group of one hundred people or things/);

  popup.destroy();
});
