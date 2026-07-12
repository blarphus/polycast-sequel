// ---------------------------------------------------------------------------
// socket/emitToUser.js -- Emit a socket event to a specific user if online
// ---------------------------------------------------------------------------

import { getUserSocketIds } from './presence.js';
import { getSocketServer } from './serverState.js';
import logger from '../logger.js';

export function emitToUser(userId, eventName, data) {
  const socketIds = getUserSocketIds(userId);
  if (socketIds.length === 0) {
    logger.warn('[emitToUser] %s -> user %s not in presence map (offline or stale)', eventName, userId);
    return;
  }
  const io = getSocketServer();
  if (io) io.to(socketIds).emit(eventName, data);
}
