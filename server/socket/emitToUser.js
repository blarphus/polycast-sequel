// ---------------------------------------------------------------------------
// socket/emitToUser.js -- Emit a socket event to a specific user if online
// ---------------------------------------------------------------------------

import { getUserSocketIds } from './presence.js';
import { getIO } from './index.js';
import logger from '../logger.js';

export function emitToUser(userId, eventName, data) {
  const socketIds = getUserSocketIds(userId);
  if (socketIds.length === 0) {
    logger.warn('[emitToUser] %s -> user %s not in presence map (offline or stale)', eventName, userId);
    return;
  }
  const io = getIO();
  if (io) io.to(socketIds).emit(eventName, data);
}

export function emitToUserExcept(userId, exceptSocketId, eventName, data) {
  const socketIds = getUserSocketIds(userId).filter((socketId) => socketId !== exceptSocketId);
  if (socketIds.length === 0) return;
  const io = getIO();
  if (io) io.to(socketIds).emit(eventName, data);
}
