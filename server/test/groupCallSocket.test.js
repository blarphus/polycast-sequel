import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleGroupCall, roomTargetSocketIds } from '../socket/groupCall.js';
import { userToSocket } from '../socket/presence.js';

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ROOM_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const TARGET_ID = '44444444-4444-4444-8444-444444444444';
const ENVELOPE = { correlationId: 'socket-correlation-1', occurredAt: '2026-07-12T00:00:00.000Z' };

function socketFixture({ rooms = [] } = {}) {
  const handlers = new Map();
  const emitted = [];
  return {
    id: 'sender-socket',
    userId: USER_ID,
    rooms: new Set(['sender-socket', ...rooms]),
    on(event, handler) { handlers.set(event, handler); },
    emit(event, payload) { emitted.push({ event, payload }); },
    join(room) { this.rooms.add(room); },
    leave(room) { this.rooms.delete(room); },
    to() { return { emit() {} }; },
    handlers,
    emitted,
  };
}

function ioFixture(targetSockets = []) {
  const forwarded = [];
  const sockets = new Map(targetSockets.map((socket) => [socket.id, socket]));
  return {
    sockets: { sockets },
    to(ids) {
      return { emit: (event, payload) => forwarded.push({ ids, event, payload }) };
    },
    in() { return { fetchSockets: async () => [] }; },
    forwarded,
  };
}

afterEach(() => userToSocket.clear());

test('group signaling rejects malformed messages with a visible diagnostic', () => {
  const socket = socketFixture({ rooms: [`group:${ROOM_ID}`] });
  const io = ioFixture();
  handleGroupCall(io, socket);

  socket.handlers.get('group:offer')({ roomId: ROOM_ID, targetUserId: TARGET_ID, offer: { type: 'offer' }, ...ENVELOPE });

  assert.equal(io.forwarded.length, 0);
  const diagnostic = socket.emitted.find(({ event }) => event === 'group:diagnostic')?.payload;
  assert.equal(diagnostic?.code, 'group_call_message_rejected');
  assert.equal(diagnostic?.source, 'server.group-call');
  assert.match(diagnostic?.detail, /offer\.sdp/);
  assert.ok(diagnostic?.correlationId);
});

test('group signaling rejects a valid message from a socket outside the room', () => {
  const socket = socketFixture();
  const io = ioFixture();
  handleGroupCall(io, socket);

  socket.handlers.get('group:offer')({
    roomId: ROOM_ID,
    targetUserId: TARGET_ID,
    offer: { type: 'offer', sdp: 'v=0' },
    ...ENVELOPE,
  });

  assert.equal(io.forwarded.length, 0);
  assert.equal(socket.emitted.at(-1)?.payload.code, 'group_call_room_membership_required');
  assert.equal(socket.emitted.at(-1)?.payload.correlationId, ENVELOPE.correlationId);
});

test('group signaling forwards only to target sockets in the same room', () => {
  userToSocket.set(TARGET_ID, new Set(['same-room', 'other-room']));
  const io = ioFixture([
    { id: 'same-room', rooms: new Set([`group:${ROOM_ID}`]) },
    { id: 'other-room', rooms: new Set([`group:${OTHER_ROOM_ID}`]) },
  ]);
  const socket = socketFixture({ rooms: [`group:${ROOM_ID}`] });
  handleGroupCall(io, socket);

  socket.handlers.get('group:offer')({
    roomId: ROOM_ID,
    targetUserId: TARGET_ID,
    offer: { type: 'offer', sdp: 'v=0' },
    ...ENVELOPE,
  });

  assert.deepEqual(roomTargetSocketIds(io, ROOM_ID, TARGET_ID), ['same-room']);
  assert.equal(io.forwarded.length, 1);
  assert.deepEqual(io.forwarded[0].ids, ['same-room']);
  assert.equal(io.forwarded[0].payload.fromUserId, USER_ID);
  assert.equal(io.forwarded[0].payload.correlationId, ENVELOPE.correlationId);
});
