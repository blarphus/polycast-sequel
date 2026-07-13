import assert from 'node:assert/strict';
import test from 'node:test';
import { strictSensePickRule, strictValidityRule } from '../lib/targetLanguageGuard.js';

test('click lookup rejects words used as another language in context', () => {
  const validity = strictValidityRule({ word: 'pie', targetLang: 'es', nativeLang: 'en' });
  const sensePick = strictSensePickRule({ word: 'pie', targetLang: 'es' });

  assert.match(validity, /set valid to false/);
  assert.match(validity, /do NOT rescue/);
  assert.match(sensePick, /cross-language homograph/);
  assert.match(sensePick, /PICK is -1/);
});
