import { userToSocket } from './presence.js';

/**
 * Handle messaging-related socket events (typing indicator relay).
 * Message send/read are handled via REST + socket emit from the route.
 */
export function handleMessaging(io, socket) {
  socket.on('message:typing', ({ friendId }) => {
    if (!friendId) return;

    const friendSocketId = userToSocket.get(friendId);
    if (friendSocketId) {
      io.to(friendSocketId).emit('message:typing', { userId: socket.userId });
    }
  });
}
