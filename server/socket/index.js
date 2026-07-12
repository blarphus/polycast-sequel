import { Server } from 'socket.io';
import cookie from 'cookie';
import { isSessionActive, verifyToken } from '../auth.js';
import { handleConnect, handleDisconnect, setupHeartbeat } from './presence.js';
import { handleSignaling } from './signaling.js';
import { handleCalls, handleCallDisconnect } from './calls.js';
import { handleTranscription } from './transcription.js';
import { handleMessaging } from './messaging.js';
import { handleGroupCall, handleGroupCallDisconnect } from './groupCall.js';
import pool from '../db.js';
import redisClient from '../redis.js';
import logger from '../logger.js';
import { setSocketServer } from './serverState.js';


/**
 * Create and configure a Socket.IO server attached to the given HTTP server.
 * Handles authentication, presence, signaling, and call events.
 *
 * @param {import('http').Server} server - Node HTTP server instance
 * @returns {Server} The Socket.IO server instance
 */
export function setupSocket(server) {
  const allowedOrigins = [
    process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    process.env.EXTENSION_ORIGIN,
  ].filter(Boolean);

  const io = new Server(server, {
    cors: {
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      },
      credentials: true,
    },
  });

  setSocketServer(io);

  // ------- Authentication middleware -------
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      const cookies = cookie.parse(cookieHeader || '');
      const token = cookies.token || socket.handshake.auth?.token || socket.handshake.query?.token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = verifyToken(token);

      if (!decoded || !await isSessionActive(decoded)) {
        return next(new Error('Invalid or expired token'));
      }

      // Attach userId to the socket for use in handlers
      socket.userId = decoded.userId;
      socket.sessionId = decoded.sessionId;
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  // ------- Connection handler -------
  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} (user: ${socket.userId})`);

    // Register presence
    handleConnect(io, socket, redisClient);

    // Register heartbeat
    setupHeartbeat(io, socket, redisClient);

    // Register signaling handlers
    handleSignaling(io, socket, pool);

    // Register call handlers
    handleCalls(io, socket, pool, redisClient);

    // Register transcription handlers
    handleTranscription(io, socket);

    // Register messaging handlers
    handleMessaging(io, socket);

    // Register group call handlers
    handleGroupCall(io, socket);

    // Socket.IO clears room membership before `disconnect`; capture and clean
    // group rooms during `disconnecting` while that authoritative state exists.
    socket.on('disconnecting', async () => {
      await handleGroupCallDisconnect(io, socket);
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      logger.info(`Socket disconnected: ${socket.id} (user: ${socket.userId})`);
      handleDisconnect(io, socket, redisClient);
      handleCallDisconnect(io, socket, pool);
    });
  });

  return io;
}
