// ---------------------------------------------------------------------------
// socket/groupCall.js — Socket.IO group call signaling (mesh WebRTC)
// ---------------------------------------------------------------------------

import { userToSocket } from './presence.js';
import pool from '../db.js';
import { markParticipantLeft } from '../lib/groupCallDb.js';

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

    // Get existing participants in the room (other sockets)
    const roomSockets = await io.in(socketRoom).fetchSockets();
    const otherUserIds = [];
    for (const s of roomSockets) {
      if (s.id !== socket.id) otherUserIds.push(s.userId);
    }

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
      await markParticipantLeft(socket.userId, roomId, today);
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
      await markParticipantLeft(socket.userId, roomId, today);
    } catch (err) {
      console.error('[group-call] Disconnect DB cleanup error:', err.message);
    }
  }
}
