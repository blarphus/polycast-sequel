import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('ordinary-page highlighting ships only behind Chrome target-language detection', async () => {
  const files = await Promise.all([
    'manifest.json',
    'background.js',
    'content/pageHighlights.js',
    'content/pageHighlights.css',
    'shared/wordPopup.css',
    '../contracts/extension-messages-v1.json',
  ].map((path) => readFile(new URL(path, root), 'utf8')));
  const shippedSource = files.join('\n');
  const manifest = JSON.parse(files[0]);
  const ordinaryPageScript = manifest.content_scripts.find((entry) =>
    entry.js.includes('content/pageHighlights.js'));

  assert.ok(ordinaryPageScript);
  assert.deepEqual(ordinaryPageScript.matches, ['http://*/*', 'https://*/*']);
  assert.ok(ordinaryPageScript.js.includes('shared/wordPopupCore.js'));
  assert.ok(ordinaryPageScript.js.includes('content/selection.js'));
  assert.ok(ordinaryPageScript.css.includes('shared/wordPopup.css'));
  assert.match(files[2], /chrome\.i18n\.detectLanguage/);
  assert.match(files[2], /PRIMARY_LANGUAGE_THRESHOLD = 50/);
  assert.match(files[2], /isPrimaryTargetLanguage/);
  assert.match(files[2], /openWordPopup/);
  assert.match(files[3], /pc-page-saved-word/);
  assert.match(files[4], /pc-popup-anchor-selected/);
  assert.doesNotMatch(shippedSource, /GET_PAGE_HIGHLIGHT_CONFIG|CLAIM_PAGE_CUE|MAYBE_ARM_WILD_RECALL/);
  assert.doesNotMatch(files[5], /SET_SITE_HIGHLIGHT_OVERRIDE/);
});
