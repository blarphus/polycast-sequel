import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredOrigins, PRODUCTION_CLIENT_ORIGIN } from './origins.js';

test('production origins fail closed to the exact deployed app and configured extension', () => {
  assert.deepEqual(configuredOrigins({ NODE_ENV: 'production', EXTENSION_ORIGIN: 'chrome-extension://extension-id' }), [
    PRODUCTION_CLIENT_ORIGIN,
    'chrome-extension://extension-id',
  ]);
  assert.throws(() => configuredOrigins({ NODE_ENV: 'production' }), /EXTENSION_ORIGIN/);
});

test('an explicit production client origin replaces the known deployment default', () => {
  assert.deepEqual(configuredOrigins({
    NODE_ENV: 'production',
    CLIENT_ORIGIN: 'https://staging.polycast.example',
    EXTENSION_ORIGIN: 'chrome-extension://extension-id',
  }), ['https://staging.polycast.example', 'chrome-extension://extension-id']);
});

test('development origins retain localhost without requiring an extension', () => {
  assert.deepEqual(configuredOrigins({ NODE_ENV: 'development' }), ['http://localhost:5173']);
});
