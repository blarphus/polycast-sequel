import { userToSocket } from './presence.js';
import { getUserDisplayInfo } from '../lib/getUserDisplayInfo.js';

/**
 * Register call lifecycle event handlers on a socket.
 * Manages call initiation, acceptance, rejection, and ending,
 * including persistence of call records in PostgreSQL.
 */
export function handleCalls(io, socket, pool, redisClient) {
  /**
   * Initiate a call to another user.
   * Payload: { peerId }
   */
  socket.on('call:initiate', async ({ peerId }) => {
    console.log(`[call] call:initiate from ${socket.userId} to ${peerId}`);
    try {
      // Check if callee is online
      const isOnline = await redisClient.exists(`online:${peerId}`);

      if (!isOnline) {
        console.log(`[call] ${peerId} is offline (Redis)`);
        socket.emit('call:error', { message: 'User is offline' });
        return;
      }

      const calleeSocketId = userToSocket.get(peerId);

      if (!calleeSocketId) {
        console.log(`[call] ${peerId} not in userToSocket map`);
        socket.emit('call:error', { message: 'User is not available' });
        return;
      }

      // Look up caller info
      const caller = await getUserDisplayInfo(socket.userId);
      if (!caller) {
        console.error(`[call] Caller user not found in DB for userId=${socket.userId}`);
      }

      console.log(`[call] Emitting call:incoming to socket ${calleeSocketId}`);
      io.to(calleeSocketId).emit('call:incoming', {
        callerId: socket.userId,
        callerUsername: caller?.username || 'Unknown',
        callerDisplayName: caller?.display_name || caller?.username || 'Unknown',
      });
    } catch (err) {
      console.error('call:initiate error:', err);
      socket.emit('call:error', { message: 'Failed to initiate call' });
    }
  });

  /**
   * Accept an incoming call.
   * Payload: { callerId }
   */
  socket.on('call:accept', async ({ callerId }) => {
    console.log(`[call] call:accept from ${socket.userId}, caller: ${callerId}`);
    try {
      const callerSocketId = userToSocket.get(callerId);

      if (callerSocketId) {
        console.log(`[call] Emitting call:accepted to socket ${callerSocketId}`);
        io.to(callerSocketId).emit('call:accepted', {
          calleeId: socket.userId,
        });
      } else {
        console.log(`[call] Caller ${callerId} not in userToSocket map`);
      }

      // Insert call record with status 'active'
      await pool.query(
        `INSERT INTO calls (caller_id, callee_id, status, started_at)
         VALUES ($1, $2, 'active', NOW())`,
        [callerId, socket.userId],
      );
    } catch (err) {
      console.error('call:accept error:', err);
      socket.emit('call:error', { message: 'Failed to accept call' });
    }
  });

  /**
   * Reject an incoming call.
   * Payload: { callerId }
   */
  socket.on('call:reject', ({ callerId }) => {
    console.log(`[call] call:reject from ${socket.userId}, caller: ${callerId}`);
    const callerSocketId = userToSocket.get(callerId);

    if (callerSocketId) {
      io.to(callerSocketId).emit('call:rejected', {
        calleeId: socket.userId,
      });
    }
  });

  /**
   * End an active call.
   * Payload: { peerId }
   */
  socket.on('call:end', async ({ peerId }) => {
    console.log(`[call] call:end from ${socket.userId}, peer: ${peerId}`);
    try {
      const peerSocketId = userToSocket.get(peerId);

      if (peerSocketId) {
        io.to(peerSocketId).emit('call:ended', {
          userId: socket.userId,
        });
      }

      // Update the most recent active call between these two users.
      // PostgreSQL doesn't support ORDER BY/LIMIT in UPDATE, so use a subquery.
      await pool.query(
        `UPDATE calls
         SET ended_at         = NOW(),
             duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER,
             status           = 'completed'
         WHERE id = (
           SELECT id FROM calls
           WHERE status = 'active'
             AND (
               (caller_id = $1 AND callee_id = $2)
               OR
               (caller_id = $2 AND callee_id = $1)
             )
             AND ended_at IS NULL
           ORDER BY started_at DESC
           LIMIT 1
         )`,
        [socket.userId, peerId],
      );
    } catch (err) {
      console.error('call:end error:', err);
      socket.emit('call:error', { message: 'Failed to end call' });
    }
  });
}
