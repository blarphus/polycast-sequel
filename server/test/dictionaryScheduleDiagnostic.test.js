import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScheduleRepairDiagnostic,
  refreshDictionarySchedule,
  runDictionaryScheduleMutation,
} from '../services/dictionaryScheduleService.js';

test('normal local-day rollover does not masquerade as a fallback', () => {
  const diagnostic = buildScheduleRepairDiagnostic({
    used: true,
    reason: 'local-day-boundary',
    changedCount: 0,
  }, 'daily-boundary-correlation');

  assert.equal(diagnostic, null);
});

test('an actual guarded schedule repair remains visibly diagnosed', () => {
  const diagnostic = buildScheduleRepairDiagnostic({
    used: true,
    reason: 'dirty-mutation',
    changedCount: 3,
  }, 'repair-correlation');

  assert.equal(diagnostic.code, 'schedule_repair_used');
  assert.equal(diagnostic.correlationId, 'repair-correlation');
  assert.match(diagnostic.detail, /overdueCardsAdjusted=3/);
});

test('a current schedule produces no diagnostic', () => {
  assert.equal(buildScheduleRepairDiagnostic({ used: false, reason: null, changedCount: 0 }), null);
});

test('expected mutation maintenance stays on the primary path without a fallback notice', async () => {
  const db = {
    async query(text) {
      if (/SELECT schedule_version/.test(text)) {
        return { rows: [{ schedule_version: 2, scheduled_version: 1, local_day: '2026-07-22', current_day: '2026-07-22' }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const outcome = await refreshDictionarySchedule({
    db, userId: 'user-1', timeZone: 'UTC', source: 'mutation', correlationId: 'mutation-correlation',
  });
  assert.equal(outcome.repair.used, true);
  assert.equal(outcome.diagnostic, null);
});

test('schedule-affecting writes and reconciliation commit in one transaction', async () => {
  const statements = [];
  let released = false;
  const client = {
    async query(text) {
      statements.push(text);
      if (/SELECT schedule_version/.test(text)) {
        return {
          rows: [{
            schedule_version: 2,
            scheduled_version: 1,
            local_day: '2026-07-24',
            current_day: '2026-07-24',
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; },
  };
  const outcome = await runDictionaryScheduleMutation({
    db: { connect: async () => client },
    userId: 'user-1',
    timeZone: 'America/Chicago',
    mutate: async (transaction) => {
      await transaction.query('DELETE FROM saved_words WHERE id = $1');
      return 'deleted';
    },
  });

  assert.equal(outcome.result, 'deleted');
  assert.equal(statements[0], 'BEGIN');
  assert.equal(statements.at(-1), 'COMMIT');
  assert.equal(statements.filter((statement) => statement === 'BEGIN').length, 1);
  assert.equal(statements.filter((statement) => statement === 'COMMIT').length, 1);
  assert.equal(released, true);
});
