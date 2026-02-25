// ---------------------------------------------------------------------------
// socket/emitToUser.js -- Emit a socket event to a specific user if online
// ---------------------------------------------------------------------------

import { userToSocket } from './presence.js';
import { getIO } from './index.js';

export function emitToUser(userId, eventName, data) {
  const socketId = userToSocket.get(userId);
  if (socketId) {
    const io = getIO();
    if (io) io.to(socketId).emit(eventName, data);
  }
}
