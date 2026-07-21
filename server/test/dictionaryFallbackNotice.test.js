import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAttachDictionaryFallback } from '../routes/dictionary/semanticRoutes.js';

test('dictionary fallback notice is shown when Gemini supplies a valid definition', () => {
  assert.equal(shouldAttachDictionaryFallback({ valid: true, definition_source: 'gemini' }), true);
});

test('invalid OCR tokens do not claim that a Gemini definition was used', () => {
  assert.equal(shouldAttachDictionaryFallback({ valid: false, definition_source: 'gemini' }), false);
});

test('native-language lookups do not use the dictionary-definition fallback notice', () => {
  assert.equal(shouldAttachDictionaryFallback({ valid: true, definition_source: 'gemini' }, 'true'), false);
});
