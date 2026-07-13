import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
