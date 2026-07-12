import assert from 'node:assert/strict';
import test from 'node:test';
import { asyncHandler, errorResponse, HttpError, ValidationError } from './httpErrors.js';
import { validate } from './validate.js';
import { z } from 'zod';

test('asyncHandler forwards rejected handlers exactly once', async () => {
  const expected = new Error('database unavailable');
  let forwarded;
  await asyncHandler(async () => { throw expected; })({}, {}, (error) => { forwarded = error; });
  assert.equal(forwarded, expected);
});

test('typed errors map to one correlated response without exposing private 500 details', () => {
  const publicResponse = errorResponse(new HttpError(409, 'Already saved', { code: 'already_saved' }), 'correlation-1');
  assert.deepEqual(publicResponse, {
    status: 409,
    body: { error: 'Already saved', code: 'already_saved', correlationId: 'correlation-1' },
  });

  const privateResponse = errorResponse(new Error('postgres password leaked here'), 'correlation-2');
  assert.deepEqual(privateResponse, {
    status: 500,
    body: { error: 'Internal server error', code: 'internal_server_error', correlationId: 'correlation-2' },
  });
});

test('validation forwards structured field diagnostics through the central mapper', () => {
  const middleware = validate({
    body: z.object({ word: z.string().trim().min(1), count: z.number().int().min(1) }),
  });
  let forwarded;
  middleware({ body: { word: '', count: 0 } }, {}, (error) => { forwarded = error; });
  assert.ok(forwarded instanceof ValidationError);
  const response = errorResponse(forwarded, 'correlation-3');
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'request_validation_failed');
  assert.deepEqual(response.body.errors.map(({ path }) => path), ['body.word', 'body.count']);
});
