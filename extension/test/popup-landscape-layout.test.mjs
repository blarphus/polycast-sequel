import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('word popup uses a landscape layout with definition-led context', async () => {
  const [core, css] = await Promise.all([
    readFile(new URL('../shared/wordPopupCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../shared/wordPopup.css', import.meta.url), 'utf8'),
  ]);

  assert.match(core, /const POPUP_WIDTH = 680/);
  assert.match(core, /class="pc-popup-main"/);
  assert.match(core, /class="pc-popup-side"/);
  assert.match(core, /class="pc-popup-primary"/);
  assert.match(core, /class="pc-popup-pos pc-popup-header-pos"/);
  assert.match(css, /width: min\(680px, calc\(100vw - 16px\)\)/);
  assert.match(css, /\.pc-popup-main[\s\S]*grid-template-columns:/);
  assert.doesNotMatch(css, /\.pc-popup-explanation[\s\S]*max-height:/);
  assert.match(css, /\.pc-popup[\s\S]*overflow-y: scroll;/);
  assert.match(css, /\.pc-popup[\s\S]*scrollbar-gutter: stable;/);
  assert.match(core, /explainBox\.scrollIntoView/);
  assert.match(css, /@media \(max-width: 560px\)/);
});
