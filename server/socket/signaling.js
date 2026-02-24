import { userToSocket } from './presence.js';

/**
 * Register WebRTC signaling event handlers on a socket.
 * Relays offer, answer, and ICE candidate messages to the target user.
 */
export function handleSignaling(io, socket) {
  /**
   * Relay a WebRTC offer to the target user.
   * Payload: { peerId, offer }
   */
  socket.on('signal:offer', ({ peerId, offer }) => {
    console.log(`[signal] offer from ${socket.userId} to ${peerId}`);
    const targetSocketId = userToSocket.get(peerId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('signal:offer', {
        fromUserId: socket.userId,
        offer,
      });
    } else {
      console.log(`[signal] offer target ${peerId} not found in userToSocket`);
    }
  });

  /**
   * Relay a WebRTC answer to the target user.
   * Payload: { peerId, answer }
   */
  socket.on('signal:answer', ({ peerId, answer }) => {
    console.log(`[signal] answer from ${socket.userId} to ${peerId}`);
    const targetSocketId = userToSocket.get(peerId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('signal:answer', {
        fromUserId: socket.userId,
        answer,
      });
    } else {
      console.log(`[signal] answer target ${peerId} not found in userToSocket`);
    }
  });

  /**
   * Relay an ICE candidate to the target user.
   * Payload: { peerId, candidate }
   */
  socket.on('signal:ice-candidate', ({ peerId, candidate }) => {
    const targetSocketId = userToSocket.get(peerId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('signal:ice-candidate', {
        fromUserId: socket.userId,
        candidate,
      });
    }
  });
}
