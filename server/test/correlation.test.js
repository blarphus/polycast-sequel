import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createApp } from '../app.js';

test('request correlation survives HTTP validation, logging, and the error response', async () => {
  const server = createApp({ clientDist: '/tmp/polycast-correlation-test-no-static' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address();
    const correlationId = 'client-correlation-123';
    const response = await fetch(`http://127.0.0.1:${port}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Correlation-ID': correlationId },
      body: JSON.stringify({ username: '', password: '' }),
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('x-correlation-id'), correlationId);
    assert.equal(payload.correlationId, correlationId);
    assert.equal(payload.code, 'request_validation_failed');
    assert.ok(payload.errors.some(({ path }) => path === 'body.username'));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
