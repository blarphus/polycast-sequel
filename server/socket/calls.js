import crypto from 'crypto';
import { getUserSocketIds } from './presence.js';
import { getUserDisplayInfo } from '../lib/getUserDisplayInfo.js';
import { sendIncomingCallVoipPushes } from '../lib/apnsVoip.js';
import logger from '../logger.js';

const ACTIVE_STATUSES = ['ringing', 'active'];

function normalizeMode(mode) {
  return mode === 'audio' ? 'audio' : 'video';
}

async function findLatestRingingCall(pool, callerId, calleeId) {
  const { rows } = await pool.query(
    `SELECT * FROM calls
     WHERE caller_id = $1
       AND callee_id = $2
       AND status = 'ringing'
       AND ended_at IS NULL
     ORDER BY started_at DESC
     LIMIT 1`,
    [callerId, calleeId],
  );
  return rows[0] ?? null;
}

async function findLatestOpenCallWithPeer(pool, userId, peerId) {
  const { rows } = await pool.query(
    `SELECT * FROM calls
     WHERE ended_at IS NULL
       AND status = ANY($3)
       AND (
         (caller_id = $1 AND callee_id = $2)
         OR
         (caller_id = $2 AND callee_id = $1)
       )
     ORDER BY started_at DESC
     LIMIT 1`,
    [userId, peerId, ACTIVE_STATUSES],
  );
  return rows[0] ?? null;
}

async function getCallForParticipant(pool, callId, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM calls
     WHERE id = $1
       AND (caller_id = $2 OR callee_id = $2)
     LIMIT 1`,
    [callId, userId],
  );
  return rows[0] ?? null;
}

async function hasOpenCall(pool, userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM calls
     WHERE ended_at IS NULL
       AND status = ANY($2)
       AND (caller_id = $1 OR callee_id = $1)
     LIMIT 1`,
    [userId, ACTIVE_STATUSES],
  );
  return rows.length > 0;
}

function emitToUserSockets(io, userId, eventName, payload, exceptSocketId = null) {
  const socketIds = getUserSocketIds(userId).filter((socketId) => socketId !== exceptSocketId);
  if (socketIds.length > 0) {
    io.to(socketIds).emit(eventName, payload);
  }
}

/**
 * Register call lifecycle event handlers on a socket.
 * Manages call initiation, acceptance, rejection, and ending,
 * including persistence of call records in PostgreSQL.
 */
export function handleCalls(io, socket, pool, redisClient) {
  /** Initiate a call to another user. Payload: { peerId, mode } */
  socket.on('call:initiate', async ({ peerId, mode }) => {
    logger.info(`[call] call:initiate from ${socket.userId} to ${peerId}`);
    try {
      if (!peerId) {
        socket.emit('call:error', { message: 'Missing call recipient' });
        return;
      }

      if (await hasOpenCall(pool, socket.userId)) {
        socket.emit('call:error', { message: 'You are already in a call' });
        return;
      }

      if (await hasOpenCall(pool, peerId)) {
        socket.emit('call:busy', { peerId, message: 'User is already in a call' });
        return;
      }

      // Look up caller info
      const caller = await getUserDisplayInfo(socket.userId);
      if (!caller) {
        logger.error(`[call] Caller user not found in DB for userId=${socket.userId}`);
      }
      const callId = crypto.randomUUID();
      const callMode = normalizeMode(mode);
      await pool.query(
        `INSERT INTO calls (id, caller_id, callee_id, status, mode, started_at)
         VALUES ($1, $2, $3, 'ringing', $4, NOW())`,
        [callId, socket.userId, peerId, callMode],
      );

      const payload = {
        callId,
        callerId: socket.userId,
        callerUsername: caller?.username || 'Unknown',
        callerDisplayName: caller?.display_name || caller?.username || 'Unknown',
        mode: callMode,
      };

      socket.emit('call:ringing', {
        callId,
        peerId,
        mode: callMode,
      });

      const calleeSocketIds = getUserSocketIds(peerId);
      if (calleeSocketIds.length > 0) {
        logger.info(`[call] Emitting call:incoming to ${calleeSocketIds.length} socket(s)`);
        io.to(calleeSocketIds).emit('call:incoming', payload);
      }

      // Always attempt VoIP push for iOS users so the call can wake
      // their device even if they appear offline or their socket is stale.
      const pushCount = await sendIncomingCallVoipPushes(pool, peerId, payload);
      if (pushCount > 0) {
        logger.info(`[call] Sent ${pushCount} VoIP push(es) to ${peerId}`);
      }

      if (calleeSocketIds.length === 0 && pushCount === 0) {
        logger.info(`[call] ${peerId} has no socket and no VoIP tokens — caller will ring until timeout`);
      }
    } catch (err) {
      logger.error({ err }, 'call:initiate error');
      socket.emit('call:error', { message: 'Failed to initiate call' });
    }
  });

  /** Accept an incoming call. Payload: { callId } (legacy: { callerId }) */
  socket.on('call:accept', async ({ callId, callerId }) => {
    logger.info(`[call] call:accept from ${socket.userId}, callId: ${callId}, caller: ${callerId}`);
    try {
      let call = callId
        ? await getCallForParticipant(pool, callId, socket.userId)
        : await findLatestRingingCall(pool, callerId, socket.userId);

      if (!call || call.callee_id !== socket.userId || call.status !== 'ringing') {
        socket.emit('call:cancelled', { callId, reason: 'Call is no longer available' });
        return;
      }

      const { rows } = await pool.query(
        `UPDATE calls
         SET status = 'active',
             accepted_at = NOW()
         WHERE id = $1
           AND status = 'ringing'
           AND ended_at IS NULL
         RETURNING *`,
        [call.id],
      );
      call = rows[0];

      if (!call) {
        socket.emit('call:cancelled', { callId, reason: 'Call was answered elsewhere' });
        return;
      }

      emitToUserSockets(io, call.caller_id, 'call:accepted', {
        callId: call.id,
        calleeId: socket.userId,
        mode: call.mode,
      });
      emitToUserSockets(io, socket.userId, 'call:cancelled', {
        callId: call.id,
        reason: 'Answered on another device',
      }, socket.id);
    } catch (err) {
      logger.error({ err }, 'call:accept error');
      socket.emit('call:error', { message: 'Failed to accept call' });
    }
  });

  /** Reject an incoming call. Payload: { callId } (legacy: { callerId }) */
  socket.on('call:reject', async ({ callId, callerId }) => {
    logger.info(`[call] call:reject from ${socket.userId}, callId: ${callId}, caller: ${callerId}`);
    try {
      const call = callId
        ? await getCallForParticipant(pool, callId, socket.userId)
        : await findLatestRingingCall(pool, callerId, socket.userId);

      if (!call || call.callee_id !== socket.userId || call.status !== 'ringing') return;

      await pool.query(
        `UPDATE calls
         SET status = 'rejected',
             ended_at = NOW(),
             ended_reason = 'rejected'
         WHERE id = $1`,
        [call.id],
      );

      emitToUserSockets(io, call.caller_id, 'call:rejected', {
        callId: call.id,
        calleeId: socket.userId,
      });
      emitToUserSockets(io, socket.userId, 'call:cancelled', {
        callId: call.id,
        reason: 'Declined on another device',
      }, socket.id);
    } catch (err) {
      logger.error({ err }, 'call:reject error');
      socket.emit('call:error', { message: 'Failed to reject call' });
    }
  });

  /** End an active/ringing call. Payload: { callId } (legacy: { peerId }) */
  socket.on('call:end', async ({ callId, peerId, reason }) => {
    logger.info(`[call] call:end from ${socket.userId}, callId: ${callId}, peer: ${peerId}`);
    try {
      const call = callId
        ? await getCallForParticipant(pool, callId, socket.userId)
        : await findLatestOpenCallWithPeer(pool, socket.userId, peerId);

      if (!call || call.ended_at) return;

      const peer = call.caller_id === socket.userId ? call.callee_id : call.caller_id;
      const endedReason = reason || (call.status === 'ringing' ? 'cancelled' : 'completed');
      const nextStatus = call.status === 'active' ? 'completed' : 'cancelled';

      const { rows } = await pool.query(
        `UPDATE calls
         SET ended_at = NOW(),
             duration_seconds = CASE
               WHEN accepted_at IS NULL THEN NULL
               ELSE EXTRACT(EPOCH FROM (NOW() - accepted_at))::INTEGER
             END,
             status = $2,
             ended_reason = $3
         WHERE id = $1
           AND ended_at IS NULL
         RETURNING *`,
        [call.id, nextStatus, endedReason],
      );

      if (rows.length === 0) return;

      const payload = {
        callId: call.id,
        userId: socket.userId,
        reason: endedReason,
      };

      if (call.status === 'ringing') {
        emitToUserSockets(io, peer, 'call:cancelled', payload);
      } else {
        emitToUserSockets(io, peer, 'call:ended', payload);
      }
      emitToUserSockets(io, socket.userId, 'call:cancelled', payload, socket.id);
    } catch (err) {
      logger.error({ err }, 'call:end error');
      socket.emit('call:error', { message: 'Failed to end call' });
    }
  });
}
