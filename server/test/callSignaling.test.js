import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { handleSignaling } from '../socket/signaling.js';
import { userToSocket } from '../socket/presence.js';

const CALL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PEER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const ENVELOPE = { correlationId: 'call-correlation-1', occurredAt: '2026-07-12T00:00:00.000Z' };

function fixture(call = { caller_id: USER_ID, callee_id: PEER_ID, status: 'active', ended_at: null }) {
  const handlers = new Map();
  const emitted = [];
  const forwarded = [];
  const socket = {
    id: 'sender-socket', userId: USER_ID,
    on: (event, handler) => handlers.set(event, handler),
    emit: (event, payload) => emitted.push({ event, payload }),
  };
  const io = { to: (ids) => ({ emit: (event, payload) => forwarded.push({ ids, event, payload }) }) };
  const pool = { query: async () => ({ rows: call ? [call] : [] }) };
  handleSignaling(io, socket, pool);
  return { handlers, emitted, forwarded };
}

afterEach(() => userToSocket.clear());

test('direct signaling rejects malformed payloads with a correlated visible diagnostic', async () => {
  const state = fixture();
  await state.handlers.get('signal:offer')({ callId: CALL_ID, peerId: PEER_ID, offer: { type: 'offer' }, ...ENVELOPE });
  assert.equal(state.forwarded.length, 0);
  const diagnostic = state.emitted.at(-1);
  assert.equal(diagnostic.event, 'call:diagnostic');
  assert.equal(diagnostic.payload.code, 'call_signal_rejected');
  assert.equal(diagnostic.payload.correlationId, ENVELOPE.correlationId);
  assert.match(diagnostic.payload.detail, /offer\.sdp/);
});

test('direct signaling rejects a peer outside the active call', async () => {
  const state = fixture();
  await state.handlers.get('signal:offer')({ callId: CALL_ID, peerId: OTHER_ID, offer: { type: 'offer', sdp: 'v=0' }, ...ENVELOPE });
  assert.equal(state.forwarded.length, 0);
  assert.equal(state.emitted.at(-1).payload.code, 'call_signal_target_mismatch');
});

test('direct signaling relays the generated envelope to the active peer only', async () => {
  userToSocket.set(PEER_ID, new Set(['peer-socket']));
  const state = fixture();
  await state.handlers.get('signal:offer')({ callId: CALL_ID, peerId: PEER_ID, offer: { type: 'offer', sdp: 'v=0' }, ...ENVELOPE });
  assert.equal(state.forwarded.length, 1);
  assert.deepEqual(state.forwarded[0].ids, ['peer-socket']);
  assert.equal(state.forwarded[0].payload.fromUserId, USER_ID);
  assert.equal(state.forwarded[0].payload.correlationId, ENVELOPE.correlationId);
});
