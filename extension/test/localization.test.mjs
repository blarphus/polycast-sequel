import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('extension popup and in-page word controls expose Spanish profile localization', async () => {
  const [popupHtml, popupJs, sharedContent, popupCore] = await Promise.all([
    readFile(new URL('../popup/popup.html', import.meta.url), 'utf8'),
    readFile(new URL('../popup/popup.js', import.meta.url), 'utf8'),
    readFile(new URL('../content/shared.js', import.meta.url), 'utf8'),
    readFile(new URL('../shared/wordPopupCore.js', import.meta.url), 'utf8'),
  ]);

  assert.match(popupHtml, /data-i18n="learningLanguage"/);
  assert.match(popupHtml, /data-i18n="useRender"/);
  assert.match(popupJs, /Idioma que aprendes/);
  assert.match(popupJs, /https:\/\/polycast-sequel\.onrender\.com/);
  assert.doesNotMatch(popupJs, /saveApiBase\('http:\/\/localhost:3001'/);
  assert.match(popupJs, /user\.native_language/);
  assert.match(sharedContent, /Agregar al diccionario/);
  assert.match(sharedContent, /native_language/);
  assert.match(popupCore, /labelOverrides/);
});
