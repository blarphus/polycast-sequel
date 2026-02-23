import { userToSocket } from './presence.js';

/**
 * Register call lifecycle event handlers on a socket.
 * Manages call initiation, acceptance, rejection, and ending,
 * including persistence of call records in PostgreSQL.
 */
export function handleCalls(io, socket, pool, redisClient) {
  /**
   * Initiate a call to another user.
   * Payload: { calleeId }
   */
  socket.on('call:initiate', async ({ calleeId }) => {
    try {
      // Check if callee is online
      const isOnline = await redisClient.exists(`online:${calleeId}`);

      if (!isOnline) {
        socket.emit('call:error', { message: 'User is offline' });
        return;
      }

      const calleeSocketId = userToSocket.get(calleeId);

      if (!calleeSocketId) {
        socket.emit('call:error', { message: 'User is not available' });
        return;
      }

      io.to(calleeSocketId).emit('call:incoming', {
        callerId: socket.userId,
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
    try {
      const callerSocketId = userToSocket.get(callerId);

      if (callerSocketId) {
        io.to(callerSocketId).emit('call:accepted', {
          calleeId: socket.userId,
        });
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
    try {
      const peerSocketId = userToSocket.get(peerId);

      if (peerSocketId) {
        io.to(peerSocketId).emit('call:ended', {
          userId: socket.userId,
        });
      }

      // Update the call record: set ended_at, compute duration, mark completed.
      // Find the most recent active call between these two users.
      await pool.query(
        `UPDATE calls
         SET ended_at         = NOW(),
             duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER,
             status           = 'completed'
         WHERE status = 'active'
           AND (
             (caller_id = $1 AND callee_id = $2)
             OR
             (caller_id = $2 AND callee_id = $1)
           )
           AND ended_at IS NULL
         ORDER BY started_at DESC
         LIMIT 1`,
        [socket.userId, peerId],
      );
    } catch (err) {
      console.error('call:end error:', err);
      socket.emit('call:error', { message: 'Failed to end call' });
    }
  });
}
