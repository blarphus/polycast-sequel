import logger from '../logger.js';

/** Maps socket.id -> userId */
const socketToUser = new Map();

/** Maps userId -> Set<socket.id> */
const userToSocket = new Map();

const PRESENCE_TTL = 60; // seconds

/**
 * Handle a new socket connection: mark the user as online in Redis
 * and broadcast their presence.
 */
export async function handleConnect(io, socket, redisClient) {
  const { userId } = socket;

  socketToUser.set(socket.id, userId);
  const sockets = userToSocket.get(userId) ?? new Set();
  sockets.add(socket.id);
  userToSocket.set(userId, sockets);

  try {
    await redisClient.set(`online:${userId}`, socket.id, { EX: PRESENCE_TTL });
  } catch (err) {
    logger.error({ err }, 'Redis SET error in handleConnect');
  }

  io.emit('user:online', { userId });
}

/**
 * Handle socket disconnection: remove the user from online state
 * and broadcast their departure.
 */
export async function handleDisconnect(io, socket, redisClient) {
  const userId = socketToUser.get(socket.id);

  if (!userId) return;

  socketToUser.delete(socket.id);

  const sockets = userToSocket.get(userId);
  if (!sockets) return;

  sockets.delete(socket.id);

  if (sockets.size === 0) {
    userToSocket.delete(userId);

    try {
      await redisClient.del(`online:${userId}`);
    } catch (err) {
      logger.error({ err }, 'Redis DEL error in handleDisconnect');
    }

    io.emit('user:offline', { userId });
  } else {
    userToSocket.set(userId, sockets);
  }
}

/**
 * Set up heartbeat listener on a socket. Each heartbeat refreshes
 * the Redis TTL so the user remains marked as online.
 */
export function setupHeartbeat(io, socket, redisClient) {
  socket.on('heartbeat', async () => {
    const userId = socketToUser.get(socket.id);

    if (!userId) return;

    try {
      await redisClient.expire(`online:${userId}`, PRESENCE_TTL);
    } catch (err) {
      logger.error({ err }, 'Redis EXPIRE error in heartbeat');
    }
  });
}

export function getUserSocketIds(userId) {
  return Array.from(userToSocket.get(userId) ?? []);
}

export function isUserOnline(userId) {
  return getUserSocketIds(userId).length > 0;
}

export { userToSocket };
