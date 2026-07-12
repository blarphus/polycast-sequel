import assert from 'node:assert/strict';
import test from 'node:test';
import { runIdempotentMutation } from './idempotency.js';

function memoryDatabase() {
  const rows = new Map();
  return {
    async query(text, values) {
      const key = `${values?.[0]}:${values?.[1]}`;
      if (/INSERT INTO idempotency_requests/.test(text)) {
        if (rows.has(key)) return { rows: [], rowCount: 0 };
        rows.set(key, { operation: values[2], request_hash: values[3], state: 'processing' });
        return { rows: [{ idempotency_key: values[1] }], rowCount: 1 };
      }
      if (/SELECT operation/.test(text)) return { rows: rows.has(key) ? [rows.get(key)] : [], rowCount: rows.has(key) ? 1 : 0 };
      if (/UPDATE idempotency_requests/.test(text)) {
        rows.set(key, { ...rows.get(key), state: 'completed', response_status: values[2], response_body: values[3] });
        return { rows: [], rowCount: 1 };
      }
      if (/DELETE FROM idempotency_requests/.test(text)) { rows.delete(key); return { rows: [], rowCount: 1 }; }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

test('lost response retry replays one persisted mutation effect', async () => {
  const db = memoryDatabase();
  const context = {
    userId: 'user-1', key: '11111111-1111-4111-8111-111111111111',
    operation: 'review-word', body: { wordId: 'word-1', answer: 'good' },
  };
  let sideEffects = 0;
  const first = await runIdempotentMutation(db, context, async () => {
    sideEffects += 1;
    return { status: 200, body: { prompt_stage: 1 } };
  });
  // Simulate the caller losing `first` before it reaches the client.
  assert.equal(first.replayed, false);
  const retry = await runIdempotentMutation(db, context, async () => {
    sideEffects += 1;
    return { status: 200, body: { prompt_stage: 2 } };
  });
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.body, { prompt_stage: 1 });
  assert.equal(sideEffects, 1);
});

test('reusing a mutation key with different input fails visibly', async () => {
  const db = memoryDatabase();
  const base = { userId: 'user-1', key: '11111111-1111-4111-8111-111111111111', operation: 'review-word' };
  await runIdempotentMutation(db, { ...base, body: { answer: 'good' } }, async () => ({ status: 200, body: {} }));
  await assert.rejects(
    runIdempotentMutation(db, { ...base, body: { answer: 'again' } }, async () => ({ status: 200, body: {} })),
    (error) => error.status === 409 && error.fallbackNotices[0].code === 'idempotency_key_reused',
  );
});
