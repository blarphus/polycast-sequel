// ---------------------------------------------------------------------------
// socket/groupCall.js — Socket.IO group call signaling (mesh WebRTC)
// ---------------------------------------------------------------------------

import { userToSocket } from './presence.js';
import { getUserDisplayInfo } from '../lib/getUserDisplayInfo.js';
import pool from '../db.js';

/**
 * Register group call event handlers on a socket.
 * Uses Socket.IO rooms for broadcast and userToSocket for peer-targeted relay.
 */
export function handleGroupCall(io, socket) {

  // ---- group:join — join a group call room ----
  socket.on('group:join', async ({ roomId }) => {
    if (!roomId) return;
    const socketRoom = `group:${roomId}`;
    console.log(`[group-call] ${socket.userId} joining room ${socketRoom}`);

    // Join the Socket.IO room
    socket.join(socketRoom);

    // Get display info for the joiner
    const info = await getUserDisplayInfo(socket.userId);
    const displayName = info?.display_name || info?.username || 'Unknown';

    // Get existing participants in the room (other sockets)
    const roomSockets = await io.in(socketRoom).fetchSockets();
    const existing = [];
    for (const s of roomSockets) {
      if (s.id === socket.id) continue;
      const pInfo = await getUserDisplayInfo(s.userId);
      existing.push({
        userId: s.userId,
        displayName: pInfo?.display_name || pInfo?.username || 'Unknown',
      });
    }

    // Send existing participants to the new joiner
    socket.emit('group:existing-participants', { roomId, participants: existing });

    // Broadcast to room that a new participant joined
    socket.to(socketRoom).emit('group:participant-joined', {
      roomId,
      userId: socket.userId,
      displayName,
    });
  });

  // ---- group:leave — leave a group call room ----
  socket.on('group:leave', async ({ roomId }) => {
    if (!roomId) return;
    const socketRoom = `group:${roomId}`;
    console.log(`[group-call] ${socket.userId} leaving room ${socketRoom}`);

    socket.leave(socketRoom);

    // Broadcast departure
    socket.to(socketRoom).emit('group:participant-left', {
      roomId,
      userId: socket.userId,
    });

    // DB cleanup: mark participant as left
    const today = new Date().toISOString().slice(0, 10);
    try {
      await pool.query(
        `UPDATE group_call_participants SET left_at = NOW()
         WHERE user_id = $1 AND left_at IS NULL
           AND group_call_id IN (
             SELECT id FROM group_calls WHERE post_id = $2 AND session_date = $3 AND status = 'active'
           )`,
        [socket.userId, roomId, today],
      );
    } catch (err) {
      console.error('[group-call] DB leave error:', err.message);
    }
  });

  // ---- group:offer — relay SDP offer to specific peer ----
  socket.on('group:offer', ({ roomId, targetUserId, offer }) => {
    const targetSocketId = userToSocket.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('group:offer', {
        roomId,
        fromUserId: socket.userId,
        offer,
      });
    }
  });

  // ---- group:answer — relay SDP answer to specific peer ----
  socket.on('group:answer', ({ roomId, targetUserId, answer }) => {
    const targetSocketId = userToSocket.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('group:answer', {
        roomId,
        fromUserId: socket.userId,
        answer,
      });
    }
  });

  // ---- group:ice — relay ICE candidate to specific peer ----
  socket.on('group:ice', ({ roomId, targetUserId, candidate }) => {
    const targetSocketId = userToSocket.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('group:ice', {
        roomId,
        fromUserId: socket.userId,
        candidate,
      });
    }
  });
}

/**
 * Handle group call cleanup when a socket disconnects.
 * Called from socket/index.js disconnect handler.
 */
export async function handleGroupCallDisconnect(io, socket) {
  // Find all group rooms this socket was in
  for (const room of socket.rooms) {
    if (!room.startsWith('group:')) continue;
    const roomId = room.slice('group:'.length);

    console.log(`[group-call] Disconnect cleanup: ${socket.userId} from ${room}`);

    // Broadcast departure to remaining participants
    socket.to(room).emit('group:participant-left', {
      roomId,
      userId: socket.userId,
    });

    // DB cleanup
    const today = new Date().toISOString().slice(0, 10);
    try {
      await pool.query(
        `UPDATE group_call_participants SET left_at = NOW()
         WHERE user_id = $1 AND left_at IS NULL
           AND group_call_id IN (
             SELECT id FROM group_calls WHERE post_id = $2 AND session_date = $3 AND status = 'active'
           )`,
        [socket.userId, roomId, today],
      );

      // End call if no active participants
      await pool.query(
        `UPDATE group_calls SET status = 'ended', ended_at = NOW()
         WHERE post_id = $1 AND session_date = $2 AND status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM group_call_participants
             WHERE group_call_id = group_calls.id AND left_at IS NULL
           )`,
        [roomId, today],
      );
    } catch (err) {
      console.error('[group-call] Disconnect DB cleanup error:', err.message);
    }
  }
}
