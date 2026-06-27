import { getUserSocketIds } from './presence.js';

/**
 * Handle messaging-related socket events (typing indicator relay).
 * Message send/read are handled via REST + socket emit from the route.
 */
export function handleMessaging(io, socket) {
  socket.on('message:typing', ({ friendId }) => {
    if (!friendId) return;

    const friendSocketIds = getUserSocketIds(friendId);
    if (friendSocketIds.length > 0) {
      io.to(friendSocketIds).emit('message:typing', { userId: socket.userId });
    }
  });
}
