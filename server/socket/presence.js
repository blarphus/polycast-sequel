/** Maps socket.id -> userId */
const socketToUser = new Map();

/** Maps userId -> socket.id */
const userToSocket = new Map();

const PRESENCE_TTL = 60; // seconds

/**
 * Handle a new socket connection: mark the user as online in Redis
 * and broadcast their presence.
 */
export async function handleConnect(io, socket, redisClient) {
  const { userId } = socket;

  socketToUser.set(socket.id, userId);
  userToSocket.set(userId, socket.id);

  try {
    await redisClient.set(`online:${userId}`, socket.id, { EX: PRESENCE_TTL });
  } catch (err) {
    console.error('Redis SET error in handleConnect:', err);
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
  userToSocket.delete(userId);

  try {
    await redisClient.del(`online:${userId}`);
  } catch (err) {
    console.error('Redis DEL error in handleDisconnect:', err);
  }

  io.emit('user:offline', { userId });
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
      console.error('Redis EXPIRE error in heartbeat:', err);
    }
  });
}

/**
 * Scan Redis for all `online:*` keys and return an array of online userIds.
 */
export async function getOnlineUsers(redisClient) {
  const userIds = [];

  try {
    let cursor = 0;

    do {
      const result = await redisClient.scan(cursor, {
        MATCH: 'online:*',
        COUNT: 100,
      });

      cursor = result.cursor;

      for (const key of result.keys) {
        // key format: "online:{userId}"
        const userId = key.slice('online:'.length);
        userIds.push(userId);
      }
    } while (cursor !== 0);
  } catch (err) {
    console.error('Redis SCAN error in getOnlineUsers:', err);
  }

  return userIds;
}

export { socketToUser, userToSocket };
