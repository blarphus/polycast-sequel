import assert from 'node:assert/strict';
import test from 'node:test';
import { API_GOLDEN_FIXTURES, AUTH_USER_REQUIRED_FIELDS } from './generated/apiContract.js';
import { serializeAuthUser } from './authResponse.js';

test('auth serializer exactly matches the canonical user fixture fields', () => {
  const actual = serializeAuthUser(API_GOLDEN_FIXTURES.authUser);
  assert.deepEqual(actual, API_GOLDEN_FIXTURES.authUser);
  assert.deepEqual(Object.keys(actual).sort(), [...AUTH_USER_REQUIRED_FIELDS].sort());
});

test('auth serializer exactly matches the canonical session fixture fields', () => {
  assert.deepEqual(
    serializeAuthUser(API_GOLDEN_FIXTURES.authUser, 'fixture-token'),
    API_GOLDEN_FIXTURES.authSession,
  );
});

test('auth serializer rejects missing required fields and unknown roles', () => {
  assert.throws(() => serializeAuthUser({ ...API_GOLDEN_FIXTURES.authUser, total_xp: undefined }), /total_xp/);
  assert.throws(() => serializeAuthUser({ ...API_GOLDEN_FIXTURES.authUser, account_type: 'admin' }), /account_type/);
});

test('server consumes the canonical fallback, transcript, socket, and extension fixtures', () => {
  assert.deepEqual(Object.keys(API_GOLDEN_FIXTURES.transcriptResponse).sort(), [
    'fallback_notices', 'kind', 'segments', 'selectedLanguage', 'success',
  ]);
  assert.equal(API_GOLDEN_FIXTURES.fallbackDiagnostic.correlationId, 'contract-correlation-1');
  assert.equal(API_GOLDEN_FIXTURES.groupCallSignal.roomId, '22222222-2222-4222-8222-222222222222');
  assert.equal(API_GOLDEN_FIXTURES.callSignal.callId, '55555555-5555-4555-8555-555555555555');
  assert.equal(API_GOLDEN_FIXTURES.extensionMessage.type, 'GET_PAGE_HIGHLIGHT_CONFIG');
});
