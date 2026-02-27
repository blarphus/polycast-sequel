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

  // Only remove from userToSocket if THIS socket is still the active one.
  // When a client reconnects, the new socket's handleConnect runs first and
  // overwrites userToSocket with the new socket ID.  If we blindly delete
  // here, we wipe the *new* socket's entry and the user becomes unreachable.
  if (userToSocket.get(userId) === socket.id) {
    userToSocket.delete(userId);

    try {
      await redisClient.del(`online:${userId}`);
    } catch (err) {
      console.error('Redis DEL error in handleDisconnect:', err);
    }

    io.emit('user:offline', { userId });
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
      console.error('Redis EXPIRE error in heartbeat:', err);
    }
  });
}

export { userToSocket };
