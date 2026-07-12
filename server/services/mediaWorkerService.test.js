import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createMediaWorkerToken } from './mediaWorkerService.js';

test('media Worker tokens are signed, scoped, short-lived, and non-repeating', () => {
  const secret = 'test-secret';
  const now = Date.UTC(2026, 6, 12, 0, 0, 0);
  const first = createMediaWorkerToken('transcript', 'user-1', { now, secret });
  const second = createMediaWorkerToken('transcript', 'user-1', { now, secret });
  assert.notEqual(first, second);

  const [version, payload, signature] = first.split('.');
  assert.equal(version, 'p1');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  assert.equal(claims.iss, 'polycast-server');
  assert.equal(claims.sub, 'user-1');
  assert.equal(claims.scope, 'transcript');
  assert.equal(claims.exp - claims.iat, 30);
  assert.equal(
    signature,
    createHmac('sha256', secret).update(`p1.${payload}`).digest('base64url'),
  );
});

test('media Worker token creation rejects unknown scopes', () => {
  assert.throws(
    () => createMediaWorkerToken('admin', 'user-1', { secret: 'test-secret' }),
    /Unsupported media Worker scope/,
  );
});
