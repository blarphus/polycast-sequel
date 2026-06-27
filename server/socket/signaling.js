import { getUserSocketIds } from './presence.js';
import logger from '../logger.js';

/**
 * Register WebRTC signaling event handlers on a socket.
 * Relays offer, answer, and ICE candidate messages to the target user.
 */
export function handleSignaling(io, socket, pool) {
  /**
   * Look up the target user's socket and relay an event to them.
   */
  function relay(eventName, peerId, payload, log) {
    if (log) logger.info(`[signal] ${log}`);
    const targetSocketIds = getUserSocketIds(peerId);
    if (targetSocketIds.length > 0) {
      io.to(targetSocketIds).emit(eventName, { fromUserId: socket.userId, ...payload });
    } else if (log) {
      logger.info(`[signal] ${eventName} target ${peerId} not found in userToSocket`);
    }
  }

  async function resolveSignalTarget(callId, peerId) {
    if (!callId) return peerId;

    const { rows } = await pool.query(
      `SELECT caller_id, callee_id, status, ended_at
       FROM calls
       WHERE id = $1
         AND (caller_id = $2 OR callee_id = $2)
       LIMIT 1`,
      [callId, socket.userId],
    );
    const call = rows[0];
    if (!call || call.ended_at || !['ringing', 'active'].includes(call.status)) {
      logger.info(`[signal] ignoring stale signal for call ${callId} from ${socket.userId}`);
      return null;
    }

    const targetUserId = call.caller_id === socket.userId ? call.callee_id : call.caller_id;
    if (peerId && peerId !== targetUserId) {
      logger.warn(`[signal] peerId ${peerId} does not match call ${callId} target ${targetUserId}`);
      return null;
    }
    return targetUserId;
  }

  socket.on('signal:offer', async ({ callId, peerId, offer }) => {
    try {
      const targetUserId = await resolveSignalTarget(callId, peerId);
      if (!targetUserId) return;
      relay('signal:offer', targetUserId, { callId, offer }, `offer from ${socket.userId} to ${targetUserId}`);
    } catch (err) {
      logger.error({ err }, 'signal:offer error');
      socket.emit('call:error', { callId, message: 'Failed to send offer' });
    }
  });

  socket.on('signal:answer', async ({ callId, peerId, answer }) => {
    try {
      const targetUserId = await resolveSignalTarget(callId, peerId);
      if (!targetUserId) return;
      relay('signal:answer', targetUserId, { callId, answer }, `answer from ${socket.userId} to ${targetUserId}`);
    } catch (err) {
      logger.error({ err }, 'signal:answer error');
      socket.emit('call:error', { callId, message: 'Failed to send answer' });
    }
  });

  socket.on('signal:ice-candidate', async ({ callId, peerId, candidate }) => {
    try {
      const targetUserId = await resolveSignalTarget(callId, peerId);
      if (!targetUserId) return;
      relay('signal:ice-candidate', targetUserId, { callId, candidate });
    } catch (err) {
      logger.error({ err }, 'signal:ice-candidate error');
      socket.emit('call:error', { callId, message: 'Failed to send ICE candidate' });
    }
  });
}
