import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('word popup displays the learner-language definition instead of the source gloss', async () => {
  const source = await readFile(new URL('../shared/wordPopupCore.js', import.meta.url), 'utf8');
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  dom.window.eval(source);

  const popup = dom.window.PolycastWordPopup.createWordPopup({
    word: 'mother',
    sentence: 'I did not expect to see you, mother.',
    anchorRect: { left: 100, right: 150, top: 100, bottom: 120, width: 50, height: 20 },
    container: dom.window.document.body,
    handlers: {
      lookup: async () => ({
        valid: true,
        translation: 'madre',
        definition: 'Mujer que tiene o cría hijos.',
        matched_gloss: 'A female parent, especially of a human.',
        part_of_speech: 'noun',
      }),
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const text = popup.el.textContent;
  assert.match(text, /madre/i);
  assert.match(text, /Mujer que tiene o cría hijos\./);
  assert.doesNotMatch(text, /A female parent/);
  popup.destroy();
});
