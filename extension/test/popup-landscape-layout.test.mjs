import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('word popup uses a landscape layout with scrollable context', async () => {
  const [core, css] = await Promise.all([
    readFile(new URL('../shared/wordPopupCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../shared/wordPopup.css', import.meta.url), 'utf8'),
  ]);

  assert.match(core, /const POPUP_WIDTH = 680/);
  assert.match(core, /class="pc-popup-main"/);
  assert.match(core, /class="pc-popup-side"/);
  assert.match(css, /width: min\(680px, calc\(100vw - 16px\)\)/);
  assert.match(css, /\.pc-popup-main[\s\S]*grid-template-columns:/);
  assert.match(css, /\.pc-popup-explanation[\s\S]*max-height: 220px;[\s\S]*overflow-y: auto;/);
  assert.match(css, /@media \(max-width: 560px\)/);
});
