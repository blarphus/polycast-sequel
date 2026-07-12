import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../db.js';
import { listDictionaryGroupPage } from '../lib/dictionaryQueries.js';

const enabled = Boolean(process.env.DATABASE_URL);

test('10k-word keyset pagination stays bounded and does not skip after a preceding insert', { skip: !enabled, timeout: 30_000 }, async () => {
  const client = await pool.connect();
  let userId;
  try {
    await client.query('BEGIN');
    const { rows: [user] } = await client.query(
      `INSERT INTO users (username, password_hash, target_language, daily_new_limit)
       VALUES ($1, 'benchmark-only', 'es', 20) RETURNING id`,
      [`pagination_${Date.now()}`],
    );
    userId = user.id;
    await client.query(
      `INSERT INTO saved_words (
         user_id, word, translation, definition, target_language, frequency,
         frequency_count, queue_position, created_at, due_at, last_reviewed_at
       )
       SELECT $1,
              'word-' || LPAD(series::text, 5, '0'),
              'translation-' || series,
              'definition-' || series,
              'es',
              1 + (series % 10),
              series * 100,
              series,
              NOW() - make_interval(secs => series),
              NOW() + make_interval(secs => series),
              CASE WHEN series % 3 = 0 THEN NOW() ELSE NULL END
       FROM generate_series(1, 10000) AS series`,
      [userId],
    );
    await client.query('COMMIT');

    const heapBefore = process.memoryUsage().heapUsed;
    const timings = [];
    const firstStarted = performance.now();
    const first = await listDictionaryGroupPage(pool, userId, { limit: 60, sort: 'az', timeZone: 'UTC' });
    timings.push(performance.now() - firstStarted);
    assert.equal(first.groups.length, 60);
    assert.equal(first.totalGroups, 10000);
    assert.ok(first.nextCursor);
    assert.ok(JSON.stringify(first).length < 1_000_000, 'page payload grew beyond a bounded response');

    // Insert before the already-seen cursor. OFFSET pagination would shift and
    // repeat/skip here; the keyset must continue at the original next word.
    await pool.query(
      `INSERT INTO saved_words (user_id, word, translation, definition, target_language, queue_position)
       VALUES ($1, 'word-00000', 'inserted', 'inserted', 'es', 0)`,
      [userId],
    );

    let cursor = first.nextCursor;
    const seen = first.groups.map((group) => group.word);
    for (let page = 1; page < 10; page += 1) {
      const started = performance.now();
      const result = await listDictionaryGroupPage(pool, userId, { cursor, limit: 60, sort: 'az', timeZone: 'UTC' });
      timings.push(performance.now() - started);
      seen.push(...result.groups.map((group) => group.word));
      cursor = result.nextCursor;
    }

    assert.equal(new Set(seen).size, 600, 'cursor pages repeated a group');
    assert.deepEqual(seen, Array.from({ length: 600 }, (_, index) => `word-${String(index + 1).padStart(5, '0')}`));
    const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
    const p95 = [...timings].sort((a, b) => a - b)[Math.floor(timings.length * 0.95)];
    assert.ok(p95 < 500, `10k-word pagination p95 exceeded 500ms: ${p95.toFixed(1)}ms`);
    assert.ok(heapDeltaMb < 40, `10 pages retained more than 40MB heap: ${heapDeltaMb.toFixed(1)}MB`);
    console.log(JSON.stringify({ event: 'dictionary_pagination_benchmark', words: 10000, pages: 10, pageSize: 60, p95Ms: Number(p95.toFixed(2)), heapDeltaMb: Number(heapDeltaMb.toFixed(2)) }));

    // Execute the second-page predicate for every supported ordering against
    // real PostgreSQL types; this catches cursor/order drift that mocks cannot.
    for (const sort of ['queue', 'date', 'az', 'freq-high', 'freq-low', 'due']) {
      const pageOne = await listDictionaryGroupPage(pool, userId, { limit: 10, sort, timeZone: 'UTC' });
      assert.ok(pageOne.nextCursor, `${sort} did not provide a continuation cursor`);
      const pageTwo = await listDictionaryGroupPage(pool, userId, { cursor: pageOne.nextCursor, limit: 10, sort, timeZone: 'UTC' });
      const firstKeys = new Set(pageOne.groups.map((group) => group.key));
      const overlap = pageTwo.groups.filter((group) => firstKeys.has(group.key)).map((group) => group.key);
      assert.deepEqual(overlap, [], `${sort} repeated groups: ${overlap.join(', ')}`);
    }
  } finally {
    if (userId) await client.query('DELETE FROM users WHERE id = $1', [userId]);
    client.release();
  }
});

test.after(async () => {
  if (enabled) await pool.end();
});
