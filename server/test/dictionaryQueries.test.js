import assert from 'node:assert/strict';
import test from 'node:test';
import { listDictionaryGroupPage, listDueWords, listNewWordPreview, listStudyOverview } from '../lib/dictionaryQueries.js';

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
    srs_interval: 86400,
    learning_step: null,
    last_reviewed_at: '2026-06-01T12:00:00Z',
    due_at: '2026-06-18T00:00:00Z',
    created_at: '2026-06-01T12:00:00Z',
  };
}

function newRow(id, queuePosition) {
  return {
    id,
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

test('listNewWordPreview returns ordered candidates without introducing cards', async () => {
  const db = recordingDatabase([{ id: 'word-1' }]);

  const result = await listNewWordPreview(db, 'user-1', 7);

  assert.deepEqual(result.rows, [{ id: 'word-1' }]);
  assert.match(db.calls[0].text, /UPDATE saved_words/);
  assert.match(db.calls[0].text, /queue_position/);
  assert.deepEqual(db.calls[0].values, ['user-1']);
  assert.match(db.calls[1].text, /SET due_at = NULL/);
  assert.match(db.calls[1].text, /last_reviewed_at IS NULL/);
  assert.deepEqual(db.calls[1].values, ['user-1']);
  assert.match(db.calls[2].text, /last_reviewed_at IS NOT NULL/);
  assert.deepEqual(db.calls[2].values, ['user-1', 'UTC']);
  assert.match(db.calls[3].text, /MIN\(due_date\)/);
  assert.deepEqual(db.calls[3].values, ['user-1', 'UTC']);
  assert.deepEqual(db.calls[4].values, ['user-1', 7]);
  assert.match(db.calls[4].text, /last_reviewed_at IS NULL/);
  assert.match(db.calls[4].text, /queue_position ASC NULLS LAST/);
  assert.doesNotMatch(db.calls[4].text, /due_at IS NOT NULL/);
  assert.doesNotMatch(db.calls[4].text, /due_at <= NOW\(\)/);
  assert.match(db.calls[4].text, /LIMIT \$2/);
  assert.doesNotMatch(db.calls[4].text, /UPDATE|INSERT/i);
});

test('listDueWords limits queued new cards without scheduling them', async () => {
  const db = recordingDatabase();

  await listDueWords(db, 'user-1', 'America/Chicago', 15);

  assert.match(db.calls[0].text, /UPDATE saved_words/);
  assert.deepEqual(db.calls[0].values, ['user-1']);
  assert.match(db.calls[1].text, /SET due_at = NULL/);
  assert.deepEqual(db.calls[1].values, ['user-1']);
  assert.deepEqual(db.calls[2].values, ['user-1', 'America/Chicago']);
  assert.deepEqual(db.calls[3].values, ['user-1', 'America/Chicago']);
  assert.deepEqual(db.calls[4].values, ['user-1', 'America/Chicago', 15]);
  assert.match(db.calls[4].text, /COALESCE\(\$3::int, daily_new_limit\)/);
  assert.match(db.calls[4].text, /introduced_today/);
  assert.match(db.calls[4].text, /sw\.queue_position ASC NULLS LAST/);
  assert.doesNotMatch(db.calls[4].text, /new_cards[\s\S]*sw\.due_at IS NOT NULL/);
  assert.doesNotMatch(db.calls[4].text, /new_cards[\s\S]*sw\.due_at <= NOW\(\)/);
  assert.doesNotMatch(db.calls[4].text, /sw\.due_at IS NULL\s+AND sw\.last_reviewed_at IS NULL/);
});

test('listDueWords spaces new cards through the review queue', async () => {
  const rows = [
    ...Array.from({ length: 100 }, (_, index) => reviewRow(`review-${index + 1}`)),
    ...Array.from({ length: 20 }, (_, index) => newRow(`new-${index + 1}`, index)),
  ];
  const db = recordingDatabase(rows);

  const result = await listDueWords(db, 'user-1', 'America/Chicago', 20);

  assert.deepEqual(result.rows.slice(0, 6).map((row) => row.id), [
    'review-1',
    'review-2',
    'review-3',
    'review-4',
    'review-5',
    'new-1',
  ]);
  assert.equal(result.rows[11].id, 'new-2');
  assert.equal(result.rows[119].id, 'new-20');
});

test('listDueWords keeps the saved daily limit when no override is supplied', async () => {
  const db = recordingDatabase();

  await listDueWords(db, 'user-1');

  assert.deepEqual(db.calls[0].values, ['user-1']);
  assert.deepEqual(db.calls[1].values, ['user-1']);
  assert.deepEqual(db.calls[2].values, ['user-1', 'UTC']);
  assert.deepEqual(db.calls[3].values, ['user-1', 'UTC']);
  assert.deepEqual(db.calls[4].values, ['user-1', 'UTC', null]);
});

test('listStudyOverview subtracts introduced cards from available new cards', async () => {
  const db = recordingDatabase([{ due: 2, new_available: 3, daily_new_limit: 5 }]);

  const overview = await listStudyOverview(db, 'user-1', 'America/Chicago');

  assert.deepEqual(overview, { due: 2, new_available: 3, daily_new_limit: 5 });
  assert.match(db.calls[4].text, /introduced_today/);
  assert.match(db.calls[4].text, /GREATEST\(COALESCE\(\(SELECT daily_new_limit FROM prefs\), 0\) - \(SELECT cnt FROM introduced_today\), 0\)/);
  assert.deepEqual(db.calls[4].values, ['user-1', 'America/Chicago']);
});

test('listDictionaryGroupPage projects queued new-card dates without setting due_at', async () => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const tomorrowDate = new Date(`${today}T00:00:00Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);

  const rows = [
    { ...newRow('new-1', 0), word: 'alpha', target_language: 'es' },
    { ...newRow('new-2', 1), word: 'beta', target_language: 'es' },
    { ...newRow('new-3', 2), word: 'gamma', target_language: 'es' },
  ];
  const db = {
    async query(text, values) {
      if (/SELECT target_language, daily_new_limit FROM users/.test(text)) {
        return { rows: [{ target_language: 'es', daily_new_limit: 5 }] };
      }
      if (/SELECT COUNT\(\*\)::int AS cnt FROM saved_words/.test(text)) {
        return { rows: [{ cnt: 3 }] };
      }
      if (/SELECT \* FROM saved_words/.test(text)) {
        return { rows };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const result = await listDictionaryGroupPage(db, 'user-1', {
    page: 0,
    limit: 10,
    sort: 'queue',
    timeZone: 'UTC',
  });

  const projected = Object.fromEntries(
    result.groups.map((group) => [group.word, group.primaryEntry.projected_due_at]),
  );
  assert.deepEqual(projected, {
    alpha: `${today}T00:00:00`,
    beta: `${today}T00:00:00`,
    gamma: `${tomorrow}T00:00:00`,
  });
  assert.equal(result.groups[0].primaryEntry.due_at, null);
});

test('scheduler rolls every day-level review card forward by missed days', async () => {
  const db = recordingDatabase();

  await listDueWords(db, 'user-1', 'America/Chicago');

  const rollover = db.calls[3];
  assert.deepEqual(rollover.values, ['user-1', 'America/Chicago']);
  assert.match(rollover.text, /MIN\(due_date\) < \(NOW\(\) AT TIME ZONE \$2\)::date/);
  assert.match(rollover.text, /SET due_at = \(/);
  assert.match(rollover.text, /date_trunc\('day', sw\.due_at AT TIME ZONE \$2\)/);
  assert.match(rollover.text, /make_interval\(days => shift\.days\)/);
  assert.match(rollover.text, /sw\.last_reviewed_at IS NOT NULL/);
  assert.match(rollover.text, /sw\.learning_step IS NULL/);
  assert.match(rollover.text, /GREATEST\(COALESCE\(sw\.srs_interval, 0\), 0\) >= 86400/);
  assert.match(rollover.text, /AND sw\.due_at IS NOT NULL/);
  assert.doesNotMatch(rollover.text, /AND \(sw\.due_at AT TIME ZONE \$2\)::date <= \(NOW\(\) AT TIME ZONE \$2\)::date/);
  assert.match(rollover.text, /shift\.days > 0/);
});
