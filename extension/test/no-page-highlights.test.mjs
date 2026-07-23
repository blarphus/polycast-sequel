import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('ordinary-page highlighting is absent from the shipped extension', async () => {
  await assert.rejects(access(new URL('content/pageHighlights.js', root)));

  const files = await Promise.all([
    'manifest.json',
    'background.js',
    'background/activation.js',
    'popup/popup.html',
    'popup/popup.js',
    'popup/popup.css',
    'overlay.css',
    'shared/wordPopup.css',
    '../contracts/extension-messages-v1.json',
  ].map((path) => readFile(new URL(path, root), 'utf8')));
  const shippedSource = files.join('\n');

  assert.doesNotMatch(shippedSource, /content\/pageHighlights\.js/);
  assert.doesNotMatch(shippedSource, /GET_PAGE_HIGHLIGHT_CONFIG|CLAIM_PAGE_CUE|MAYBE_ARM_WILD_RECALL/);
  assert.doesNotMatch(files[8], /SET_SITE_HIGHLIGHT_OVERRIDE/);
  assert.doesNotMatch(shippedSource, /pc-page-saved-word|polycast-saved|pc-page-recall-indicator/);
  assert.doesNotMatch(files[0], /optional_host_permissions/);
});
