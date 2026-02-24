import { userToSocket } from './presence.js';

/**
 * Register WebRTC signaling event handlers on a socket.
 * Relays offer, answer, and ICE candidate messages to the target user.
 */
export function handleSignaling(io, socket) {
  /**
   * Look up the target user's socket and relay an event to them.
   */
  function relay(eventName, peerId, payload, log) {
    if (log) console.log(`[signal] ${log}`);
    const targetSocketId = userToSocket.get(peerId);
    if (targetSocketId) {
      io.to(targetSocketId).emit(eventName, { fromUserId: socket.userId, ...payload });
    } else if (log) {
      console.log(`[signal] ${eventName} target ${peerId} not found in userToSocket`);
    }
  }

  socket.on('signal:offer', ({ peerId, offer }) => {
    relay('signal:offer', peerId, { offer }, `offer from ${socket.userId} to ${peerId}`);
  });

  socket.on('signal:answer', ({ peerId, answer }) => {
    relay('signal:answer', peerId, { answer }, `answer from ${socket.userId} to ${peerId}`);
  });

  socket.on('signal:ice-candidate', ({ peerId, candidate }) => {
    relay('signal:ice-candidate', peerId, { candidate });
  });
}
