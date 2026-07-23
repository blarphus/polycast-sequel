import assert from 'node:assert/strict';
import test from 'node:test';
import { setFallbackDiagnosticHeader } from '../lib/fallbackDiagnostics.js';

test('transient fallback diagnostic headers cannot be replayed from cache', () => {
  const headers = new Map();
  const res = {
    getHeader(name) { return headers.get(name); },
    setHeader(name, value) { headers.set(name, value); },
  };

  setFallbackDiagnosticHeader(res, {
    code: 'schedule_repair_used',
    correlationId: 'one-repair',
  });

  assert.equal(headers.get('Cache-Control'), 'private, no-store');
  assert.ok(headers.get('X-Polycast-Fallback-Diagnostics'));
});
