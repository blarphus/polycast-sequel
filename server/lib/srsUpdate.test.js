import test from 'node:test';
import assert from 'node:assert/strict';
import { applySrsReview, validTimeZone } from './srsUpdate.js';

test('validTimeZone accepts IANA zones and rejects invalid values', () => {
  assert.equal(validTimeZone('America/Chicago'), 'America/Chicago');
  assert.equal(validTimeZone('not/a-zone'), 'UTC');
});

test('day intervals are stored at local midnight in the supplied timezone', async () => {
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (queries.length === 1) {
        return {
          rows: [{
            srs_interval: 86400,
            ease_factor: 2.5,
            learning_step: null,
            prompt_stage: 0,
          }],
        };
      }
      return { rows: [{ id: 'card-1' }] };
    },
  };

  await applySrsReview(db, 'card-1', 'user-1', 'good', 'America/Chicago');

  assert.match(queries[1].sql, /date_trunc\('day', NOW\(\) AT TIME ZONE \$10\)/);
  assert.equal(queries[1].params[9], 'America/Chicago');
  assert.equal(queries[1].params[10], 3);
  assert.equal(queries[1].params[11], 'good');
});
