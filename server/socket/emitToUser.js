// ---------------------------------------------------------------------------
// socket/emitToUser.js -- Emit a socket event to a specific user if online
// ---------------------------------------------------------------------------

import { userToSocket } from './presence.js';
import { getIO } from './index.js';
import logger from '../logger.js';

export function emitToUser(userId, eventName, data) {
  const socketId = userToSocket.get(userId);
  if (!socketId) {
    logger.warn('[emitToUser] %s -> user %s not in presence map (offline or stale)', eventName, userId);
    return;
  }
  const io = getIO();
  if (io) io.to(socketId).emit(eventName, data);
}
