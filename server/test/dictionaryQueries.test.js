import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureCardsScheduled,
  ensureScheduleCurrent,
  listDictionaryGroupPage,
  listDueWords,
  listNewWordPreview,
  listStudyOverview,
  listWidgetPreview,
} from '../lib/dictionaryQueries.js';

function recordingDatabase(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      return { rows };
    },
  };
}

function reviewRow(id) {
  return {
    id,
    word: id,
    target_language: 'es',
    srs_interval: 86400,
    learning_step: null,
    last_reviewed_at: '2026-06-01T12:00:00Z',
    due_at: '2026-06-18T00:00:00Z',
    created_at: '2026-06-01T12:00:00Z',
    priority: false,
    frequency_count: 0,
    frequency: 0,
  };
}

function newRow(id, queuePosition) {
  return {
    id,
    word: id,
    target_language: 'es',
    srs_interval: 0,
    learning_step: null,
    last_reviewed_at: null,
    due_at: null,
    queue_position: queuePosition,
    priority: false,
    frequency_count: 0,
    frequency: 0,
    created_at: '2026-06-01T12:00:00Z',
  };
}

test('dictionary preview is a pure ordered read', async () => {
  const db = recordingDatabase([{ id: 'word-1' }]);
  const result = await listNewWordPreview(db, 'user-1', 7);

  assert.deepEqual(result.rows, [{ id: 'word-1' }]);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].values, ['user-1', 7]);
  assert.match(db.calls[0].text, /frequency_count DESC NULLS LAST/);
  assert.match(db.calls[0].text, /frequency DESC NULLS LAST/);
  assert.ok(db.calls[0].text.indexOf('frequency DESC') < db.calls[0].text.indexOf('frequency_count DESC'));
  assert.match(db.calls[0].text, /queue_position ASC NULLS LAST/);
  assert.doesNotMatch(db.calls[0].text, /UPDATE|INSERT|DELETE/i);
});

test('due queue is a pure read and keeps the supplied daily limit', async () => {
  const db = recordingDatabase();
  await listDueWords(db, 'user-1', 'America/Chicago', 15);

  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].values, ['user-1', 'America/Chicago', 15]);
  assert.match(db.calls[0].text, /COALESCE\(\$3::int, daily_new_limit\)/);
  assert.match(db.calls[0].text, /introduced_today/);
  assert.doesNotMatch(db.calls[0].text, /UPDATE|INSERT|DELETE/i);
});

test('due queue uses the saved daily limit when override is absent', async () => {
  const db = recordingDatabase();
  await listDueWords(db, 'user-1');
  assert.deepEqual(db.calls[0].values, ['user-1', 'UTC', null]);
});

test('new-card study order is frequency-first even when stored positions are stale', async () => {
  const lowerFrequency = { ...newRow('lower-frequency', 0), frequency: 8, frequency_count: 800 };
  const higherFrequency = { ...newRow('higher-frequency', 1), frequency: 10, frequency_count: 1200 };
  const db = recordingDatabase([lowerFrequency, higherFrequency]);

  const result = await listDueWords(db, 'user-1', 'America/Chicago', 2);

  assert.deepEqual(result.rows.map((row) => row.id), ['higher-frequency', 'lower-frequency']);
  assert.match(db.calls[0].text, /frequency_count DESC NULLS LAST/);
  assert.match(db.calls[0].text, /frequency DESC NULLS LAST/);
});

test('due queue spaces new cards through reviews and paginates after interleaving', async () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, index) => reviewRow(`review-${index + 1}`)),
    ...Array.from({ length: 2 }, (_, index) => newRow(`new-${index + 1}`, index)),
  ];
  const db = recordingDatabase(rows);
  const result = await listDueWords(db, 'user-1', 'America/Chicago', 2, 5, 4);
  assert.deepEqual(result.rows.map((row) => row.id), ['review-5', 'new-1', 'review-6', 'review-7', 'review-8']);
});

test('study overview subtracts introduced cards without a scheduling write', async () => {
  const db = recordingDatabase([{ due: 2, new_available: 3, daily_new_limit: 5 }]);
  const overview = await listStudyOverview(db, 'user-1', 'America/Chicago');
  assert.deepEqual(overview, { due: 2, new_available: 3, daily_new_limit: 5 });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].text, /introduced_today/);
  assert.doesNotMatch(db.calls[0].text, /UPDATE|INSERT|DELETE/i);
});

test('widget preview performs two bounded pure reads', async () => {
  const db = {
    calls: [],
    async query(text, values) {
      this.calls.push({ text, values });
      if (/SELECT\s+\(SELECT COUNT\(\*\)::int FROM saved_words/.test(text)) {
        return { rows: [{ due: 12, new_available: 5, daily_new_limit: 5 }] };
      }
      return { rows: [{ id: 'preview-1' }] };
    },
  };
  const result = await listWidgetPreview(db, 'user-1', 8, 'America/Chicago');
  assert.deepEqual(result, {
    overview: { due: 12, new_available: 5, daily_new_limit: 5 },
    words: [{ id: 'preview-1' }],
  });
  assert.equal(db.calls.length, 2);
  for (const call of db.calls) assert.doesNotMatch(call.text, /UPDATE|INSERT|DELETE/i);
});

function pagedGroupDatabase({ rows, pageKeys, dueKeys = pageKeys, dailyNewLimit = 5, introducedToday = 0 }) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      if (/SELECT target_language, daily_new_limit FROM users/.test(text)) {
        return { rows: [{ target_language: 'es', daily_new_limit: dailyNewLimit }] };
      }
      if (/SELECT COUNT\(\*\)::int AS count FROM summaries/.test(text)) {
        return { rows: [{ count: pageKeys.length }] };
      }
      if (/SELECT COUNT\(\*\)::int AS cnt FROM saved_words/.test(text)) {
        return { rows: [{ cnt: introducedToday }] };
      }
      if (/WHERE has_new/.test(text)) return { rows: dueKeys };
      if (/SELECT word, target_language,/.test(text)) return { rows: pageKeys };
      if (/jsonb_to_recordset/.test(text)) {
        const keys = JSON.parse(values[2]);
        const wanted = new Set(keys.map((key) => `${key.word}|${key.target_language || ''}`));
        return { rows: rows.filter((row) => wanted.has(`${row.word}|${row.target_language || ''}`)) };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

test('group pagination fetches only page keys/entries and projects new-card dates', async () => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const rows = [newRow('alpha', 0), newRow('beta', 1), newRow('gamma', 2)];
  const pageKeys = rows.map(({ word, target_language }) => ({ word, target_language }));
  const db = pagedGroupDatabase({ rows, pageKeys, dailyNewLimit: 2 });

  const result = await listDictionaryGroupPage(db, 'user-1', { limit: 10, sort: 'queue', timeZone: 'UTC' });
  assert.deepEqual(result.groups.map((group) => group.word), ['alpha', 'beta', 'gamma']);
  assert.equal(result.groups[0].primaryEntry.projected_due_at, `${today}T00:00:00`);
  assert.equal(result.groups[0].primaryEntry.due_at, null);
  assert.ok(db.calls.some((call) => /LIMIT \$4/.test(call.text) && !/OFFSET/.test(call.text)));
  assert.ok(db.calls.some((call) => /jsonb_to_recordset/.test(call.text)));
  assert.ok(db.calls.every((call) => !/UPDATE|INSERT|DELETE/i.test(call.text)));
});

test('group pagination orders by the visible frequency band before the corpus tie-breaker', async () => {
  const rows = [
    { ...newRow('high', 0), frequency: 3, frequency_count: 900 },
    { ...newRow('middle', 1), frequency: 3, frequency_count: 600 },
    { ...newRow('low', 2), frequency: 2, frequency_count: null },
  ];
  const pageKeys = rows.map(({ word, target_language }) => ({ word, target_language }));
  const db = pagedGroupDatabase({ rows, pageKeys });
  const result = await listDictionaryGroupPage(db, 'user-1', { limit: 10, sort: 'freq-high' });
  assert.deepEqual(result.groups.map((group) => group.word), ['high', 'middle', 'low']);
  const pageQuery = db.calls.find((call) => /SELECT word, target_language,/.test(call.text));
  assert.match(pageQuery.text, /max_frequency DESC NULLS LAST, max_frequency_count DESC NULLS LAST/);
});

test('explicit mutation scheduling retains bounded repair/rollover behavior', async () => {
  const db = recordingDatabase();
  await ensureCardsScheduled(db, 'user-1', 'America/Chicago');
  assert.equal(db.calls.length, 4);
  assert.match(db.calls[0].text, /UPDATE saved_words/);
  assert.match(db.calls[3].text, /overdue_review_cards/);
  assert.deepEqual(db.calls[3].values, ['user-1', 'America/Chicago']);
});

test('current schedule check is read-only and skips repair work', async () => {
  const calls = [];
  const db = {
    async query(text, values) {
      calls.push({ text, values });
      if (/SELECT schedule_version/.test(text)) {
        return { rows: [{ schedule_version: 4, scheduled_version: 4, local_day: '2026-07-12', current_day: '2026-07-12' }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const result = await ensureScheduleCurrent(db, 'user-1', 'UTC');
  assert.deepEqual(result, { used: false, reason: null, changedCount: 0 });
  assert.equal(calls.filter((call) => /UPDATE saved_words/.test(call.text)).length, 0);
  assert.equal(calls.filter((call) => /INSERT INTO user_schedule_state/.test(call.text)).length, 0);
});

test('dirty schedule check performs one repair transaction and records its reason', async () => {
  const calls = [];
  const db = {
    async query(text, values) {
      calls.push({ text, values });
      if (/SELECT schedule_version/.test(text)) {
        return { rows: [{ schedule_version: 5, scheduled_version: 4, local_day: '2026-07-12', current_day: '2026-07-12' }] };
      }
      return { rows: [], rowCount: /overdue_review_cards/.test(text) ? 2 : 0 };
    },
  };
  const result = await ensureScheduleCurrent(db, 'user-1', 'UTC');
  assert.deepEqual(result, { used: true, reason: 'dirty-mutation', changedCount: 2 });
  assert.equal(calls.filter((call) => /UPDATE saved_words/.test(call.text)).length, 4);
  assert.equal(calls.filter((call) => /INSERT INTO user_schedule_state/.test(call.text)).length, 1);
});
