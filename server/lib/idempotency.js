import crypto from 'node:crypto';

function requestHash(operation, body) {
  return crypto.createHash('sha256').update(`${operation}\n${JSON.stringify(body)}`).digest('hex');
}

function idempotencyError(status, code, message, detail) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  error.fallbackNotices = [{
    code,
    severity: 'warning',
    title: 'Mutation retry could not continue',
    message,
    source: 'server.idempotency',
    operation: 'deduplicate-mutation',
    correlationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    detail,
  }];
  return error;
}

/**
 * Reserve a mutation key, execute once, and persist the response before the
 * caller writes it to the network. A retry after a lost response replays the
 * persisted result without invoking the side effect again.
 */
export async function runIdempotentMutation(db, { userId, key, operation, body }, handler) {
  if (!key) return { ...(await handler()), replayed: false };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw idempotencyError(400, 'idempotency_key_invalid', 'The mutation retry key is invalid.', `operation=${operation}`);
  }
  const hash = requestHash(operation, body);
  const inserted = await db.query(
    `INSERT INTO idempotency_requests (
       user_id, idempotency_key, operation, request_hash, state
     ) VALUES ($1, $2, $3, $4, 'processing')
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING idempotency_key`,
    [userId, key, operation, hash],
  );

  if (inserted.rowCount === 0) {
    const { rows: [existing] } = await db.query(
      `SELECT operation, request_hash, state, response_status, response_body
       FROM idempotency_requests
       WHERE user_id = $1 AND idempotency_key = $2 AND expires_at > NOW()`,
      [userId, key],
    );
    if (!existing) throw idempotencyError(409, 'idempotency_key_expired', 'The mutation retry key has expired.', `operation=${operation}`);
    if (existing.operation !== operation || existing.request_hash !== hash) {
      throw idempotencyError(409, 'idempotency_key_reused', 'The mutation retry key was already used for different request data.', `operation=${operation}`);
    }
    if (existing.state !== 'completed') {
      throw idempotencyError(409, 'idempotency_request_in_progress', 'The original mutation is still processing. Wait before retrying.', `operation=${operation}`);
    }
    return { status: existing.response_status, body: existing.response_body, replayed: true };
  }

  try {
    const result = await handler();
    await db.query(
      `UPDATE idempotency_requests
       SET state = 'completed', response_status = $3, response_body = $4, completed_at = NOW()
       WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, key, result.status, result.body],
    );
    return { ...result, replayed: false };
  } catch (error) {
    await db.query(
      `DELETE FROM idempotency_requests
       WHERE user_id = $1 AND idempotency_key = $2 AND state = 'processing'`,
      [userId, key],
    );
    throw error;
  }
}
