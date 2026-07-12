// ---------------------------------------------------------------------------
// socket/groupCall.js — Socket.IO group call signaling (mesh WebRTC)
// ---------------------------------------------------------------------------

import { getUserSocketIds } from './presence.js';
import { randomUUID } from 'node:crypto';
import pool from '../db.js';
import { markParticipantLeft } from '../lib/groupCallDb.js';
import logger from '../logger.js';
import { z } from 'zod';
import { normalizeFallbackDiagnostic } from '../lib/fallbackDiagnostics.js';

const envelopeSchema = z.object({
  correlationId: z.string().min(1).max(200),
  occurredAt: z.string().datetime(),
}).strict();
const roomSchema = envelopeSchema.extend({ roomId: z.string().uuid() }).strict();
const offerSchema = roomSchema.extend({
  targetUserId: z.string().uuid(),
  offer: z.object({ type: z.literal('offer'), sdp: z.string().min(1).max(200_000) }).strict(),
}).strict();
const answerSchema = roomSchema.extend({
  targetUserId: z.string().uuid(),
  answer: z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(200_000) }).strict(),
}).strict();
const iceSchema = roomSchema.extend({
  targetUserId: z.string().uuid(),
  candidate: z.object({
    candidate: z.string().max(16_384),
    sdpMid: z.string().max(256).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65_535).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }).strict(),
}).strict();

function reportSocketFallback(socket, input, operation) {
  const diagnostic = normalizeFallbackDiagnostic(input, {
    source: 'server.group-call',
    operation,
  });
  logger.warn({ fallback: diagnostic, socketId: socket.id, userId: socket.userId }, 'Group call fallback path used');
  socket.emit('group:diagnostic', diagnostic);
}

function parseEvent(socket, schema, payload, operation) {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  reportSocketFallback(socket, {
    code: 'group_call_message_rejected',
    severity: 'error',
    title: 'Group call message rejected',
    message: `The ${operation} signaling message was malformed and was not forwarded.`,
    detail: result.error.issues.map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`).join('; '),
    ...(typeof payload?.correlationId === 'string' ? { correlationId: payload.correlationId } : {}),
    ...(typeof payload?.occurredAt === 'string' ? { occurredAt: payload.occurredAt } : {}),
  }, operation);
  return null;
}

function ensureMembership(socket, data, operation) {
  const { roomId, correlationId, occurredAt } = data;
  if (socket.rooms.has(`group:${roomId}`)) return true;
  reportSocketFallback(socket, {
    code: 'group_call_room_membership_required',
    severity: 'error',
    title: 'Group call signaling blocked',
    message: `The ${operation} message targeted a room this socket has not joined. It was not forwarded.`,
    detail: `roomId=${roomId}`,
    correlationId,
    occurredAt,
  }, operation);
  return false;
}

export function roomTargetSocketIds(io, roomId, targetUserId) {
  const room = `group:${roomId}`;
  return getUserSocketIds(targetUserId).filter((socketId) => io.sockets.sockets.get(socketId)?.rooms.has(room));
}

function hasAnotherUserSocketInRoom(io, socket, roomId) {
  return roomTargetSocketIds(io, roomId, socket.userId).some((socketId) => socketId !== socket.id);
}

function newSocketEnvelope() {
  return { correlationId: randomUUID(), occurredAt: new Date().toISOString() };
}

/**
 * Register group call event handlers on a socket.
 * Uses Socket.IO rooms for broadcast and userToSocket for peer-targeted relay.
 */
export function handleGroupCall(io, socket) {

  // ---- group:join — join a group call room ----
  socket.on('group:join', async (payload) => {
    const data = parseEvent(socket, roomSchema, payload, 'group:join');
    if (!data) return;
    const { roomId, correlationId, occurredAt } = data;
    const socketRoom = `group:${roomId}`;
    logger.info(`[group-call] ${socket.userId} joining room ${socketRoom}`);

    // Join the Socket.IO room
    socket.join(socketRoom);

    // Get existing participants in the room (other sockets)
    try {
      const roomSockets = await io.in(socketRoom).fetchSockets();
      const otherUserIds = [...new Set(roomSockets
        .filter((candidate) => candidate.id !== socket.id && candidate.userId !== socket.userId)
        .map((candidate) => candidate.userId))];

    // Batch-fetch display info for joiner + all existing participants
      const allIds = [socket.userId, ...otherUserIds];
      const { rows: userRows } = await pool.query(
      `SELECT id, display_name, username FROM users WHERE id = ANY($1)`,
      [allIds],
    );
      const userMap = new Map(userRows.map((r) => [r.id, r]));

      const joinerInfo = userMap.get(socket.userId);
      const displayName = joinerInfo?.display_name || joinerInfo?.username || 'Unknown';

      const existing = otherUserIds.map((uid) => {
        const info = userMap.get(uid);
        return {
          userId: uid,
          displayName: info?.display_name || info?.username || 'Unknown',
        };
      });

    // Send existing participants to the new joiner
      socket.emit('group:existing-participants', { roomId, participants: existing, correlationId, occurredAt });

    // Broadcast to room that a new participant joined
      socket.to(socketRoom).emit('group:participant-joined', {
        roomId,
        userId: socket.userId,
        displayName,
        correlationId,
        occurredAt,
      });
    } catch (error) {
      socket.leave(socketRoom);
      reportSocketFallback(socket, {
        code: 'group_call_join_fallback',
        severity: 'error',
        title: 'Group call signaling join failed',
        message: 'The realtime room could not load its participant list, so the socket was removed from that room. Retry joining safely.',
        detail: error instanceof Error ? error.message : String(error),
      }, 'group:join');
    }
  });

  // ---- group:leave — leave a group call room ----
  socket.on('group:leave', async (payload) => {
    const data = parseEvent(socket, roomSchema, payload, 'group:leave');
    if (!data) return;
    const { roomId, correlationId, occurredAt } = data;
    const socketRoom = `group:${roomId}`;
    logger.info(`[group-call] ${socket.userId} leaving room ${socketRoom}`);

    socket.leave(socketRoom);

    // A participant is a user, not a browser tab. Keep the user active while
    // another authenticated socket for that user remains in this room.
    if (hasAnotherUserSocketInRoom(io, socket, roomId)) return;

    // Broadcast departure
    socket.to(socketRoom).emit('group:participant-left', {
      roomId,
      userId: socket.userId,
      correlationId,
      occurredAt,
    });

    // DB cleanup: mark participant as left
    const today = new Date().toISOString().slice(0, 10);
    try {
      await markParticipantLeft(socket.userId, roomId, today);
    } catch (err) {
      reportSocketFallback(socket, {
        code: 'group_call_leave_persistence_failed',
        severity: 'warning',
        title: 'Group call departure was not persisted',
        message: 'The socket left the realtime room, but the database departure update failed. Disconnect cleanup will retry it.',
        detail: err instanceof Error ? err.message : String(err),
      }, 'group:leave');
    }
  });

  // ---- group:offer — relay SDP offer to specific peer ----
  socket.on('group:offer', (payload) => {
    const data = parseEvent(socket, offerSchema, payload, 'group:offer');
    if (!data || !ensureMembership(socket, data, 'group:offer')) return;
    const { roomId, targetUserId, offer, correlationId, occurredAt } = data;
    const targetSocketIds = roomTargetSocketIds(io, roomId, targetUserId);
    if (targetSocketIds.length > 0) {
      io.to(targetSocketIds).emit('group:offer', {
        roomId,
        fromUserId: socket.userId,
        offer,
        correlationId,
        occurredAt,
      });
    }
  });

  // ---- group:answer — relay SDP answer to specific peer ----
  socket.on('group:answer', (payload) => {
    const data = parseEvent(socket, answerSchema, payload, 'group:answer');
    if (!data || !ensureMembership(socket, data, 'group:answer')) return;
    const { roomId, targetUserId, answer, correlationId, occurredAt } = data;
    const targetSocketIds = roomTargetSocketIds(io, roomId, targetUserId);
    if (targetSocketIds.length > 0) {
      io.to(targetSocketIds).emit('group:answer', {
        roomId,
        fromUserId: socket.userId,
        answer,
        correlationId,
        occurredAt,
      });
    }
  });

  // ---- group:ice — relay ICE candidate to specific peer ----
  socket.on('group:ice', (payload) => {
    const data = parseEvent(socket, iceSchema, payload, 'group:ice');
    if (!data || !ensureMembership(socket, data, 'group:ice')) return;
    const { roomId, targetUserId, candidate, correlationId, occurredAt } = data;
    const targetSocketIds = roomTargetSocketIds(io, roomId, targetUserId);
    if (targetSocketIds.length > 0) {
      io.to(targetSocketIds).emit('group:ice', {
        roomId,
        fromUserId: socket.userId,
        candidate,
        correlationId,
        occurredAt,
      });
    }
  });
}

/**
 * Handle group call cleanup while a socket is disconnecting, before Socket.IO
 * clears its room membership.
 */
export async function handleGroupCallDisconnect(io, socket) {
  // Find all group rooms this socket was in
  for (const room of socket.rooms) {
    if (!room.startsWith('group:')) continue;
    const roomId = room.slice('group:'.length);

    if (hasAnotherUserSocketInRoom(io, socket, roomId)) continue;

    logger.info(`[group-call] Disconnect cleanup: ${socket.userId} from ${room}`);

    // Broadcast departure to remaining participants
    socket.to(room).emit('group:participant-left', {
      roomId,
      userId: socket.userId,
      ...newSocketEnvelope(),
    });

    // DB cleanup
    const today = new Date().toISOString().slice(0, 10);
    try {
      await markParticipantLeft(socket.userId, roomId, today);
    } catch (err) {
      reportSocketFallback(socket, {
        code: 'group_call_disconnect_persistence_failed',
        severity: 'warning',
        title: 'Disconnected group call cleanup failed',
        message: 'The realtime connection closed, but its database departure update failed. The stale participant record will require the bounded stale-session repair path.',
        detail: err instanceof Error ? err.message : String(err),
      }, 'socket-disconnecting');
    }
  }
}
