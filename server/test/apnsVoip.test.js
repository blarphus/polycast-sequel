import assert from 'node:assert/strict';
import test from 'node:test';
import { getApnsHost } from '../lib/apnsVoip.js';

test('getApnsHost routes development tokens to APNS sandbox', () => {
  assert.equal(getApnsHost('development'), 'https://api.sandbox.push.apple.com');
  assert.equal(getApnsHost('sandbox'), 'https://api.sandbox.push.apple.com');
});

test('getApnsHost routes production tokens to APNS production', () => {
  assert.equal(getApnsHost('production'), 'https://api.push.apple.com');
  assert.equal(getApnsHost(undefined), 'https://api.push.apple.com');
});
