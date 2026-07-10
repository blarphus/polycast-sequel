import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_ACTIVITY_XP_TARGET,
  SESSION_COMPLETION_XP,
  SESSION_DAILY_CAP,
  XP_PER_LEVEL,
  localDate,
} from '../lib/progression.js';

test('progression defaults stay aligned with the daily XP plan', () => {
  assert.equal(DAILY_ACTIVITY_XP_TARGET, 50);
  assert.equal(SESSION_COMPLETION_XP, 25);
  assert.equal(SESSION_DAILY_CAP, 2);
  assert.equal(XP_PER_LEVEL, 250);
});

test('localDate respects the supplied learner timezone', () => {
  const instant = new Date('2026-07-11T01:30:00Z');
  assert.equal(localDate('America/Chicago', instant), '2026-07-10');
  assert.equal(localDate('Asia/Tokyo', instant), '2026-07-11');
});
