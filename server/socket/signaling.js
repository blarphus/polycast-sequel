import { userToSocket } from './presence.js';

/**
 * Register WebRTC signaling event handlers on a socket.
 * Relays offer, answer, and ICE candidate messages to the target user.
 */
export function handleSignaling(io, socket) {
  /**
   * Relay a WebRTC offer to the target user.
   * Payload: { targetUserId, offer }
   */
  socket.on('signal:offer', ({ targetUserId, offer }) => {
    const targetSocketId = userToSocket.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('signal:offer', {
        fromUserId: socket.userId,
        offer,
      });
    }
  });

  /**
   * Relay a WebRTC answer to the target user.
   * Payload: { targetUserId, answer }
   */
  socket.on('signal:answer', ({ targetUserId, answer }) => {
    const targetSocketId = userToSocket.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('signal:answer', {
        fromUserId: socket.userId,
        answer,
      });
    }
  });

  /**
   * Relay an ICE candidate to the target user.
   * Payload: { targetUserId, candidate }
   */
  socket.on('signal:ice-candidate', ({ targetUserId, candidate }) => {
    const targetSocketId = userToSocket.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('signal:ice-candidate', {
        fromUserId: socket.userId,
        candidate,
      });
    }
  });
}
