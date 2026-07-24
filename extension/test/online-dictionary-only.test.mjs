import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('extension ships no offline dictionary mode or app bridge', async () => {
  const [background, contractSource, manifestSource] = await Promise.all([
    readFile(new URL('../background.js', import.meta.url), 'utf8'),
    readFile(new URL('../../contracts/extension-messages-v1.json', import.meta.url), 'utf8'),
    readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
  ]);
  const contract = JSON.parse(contractSource);
  const manifest = JSON.parse(manifestSource);
  const contentScripts = manifest.content_scripts.flatMap((entry) => entry.js);

  assert.equal('GET_OFFLINE_DICTIONARY_FULL' in contract.messages, false);
  assert.equal('UPDATE_OFFLINE_DICTIONARY' in contract.messages, false);
  assert.equal(contentScripts.includes('content/app-bridge.js'), false);
  assert.equal(background.includes('saveOfflineWord'), false);
  assert.equal(background.includes('startOfflineMode'), false);
});
