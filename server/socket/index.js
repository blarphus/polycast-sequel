import { Server } from 'socket.io';
import { verifyToken } from '../auth.js';
import { handleConnect, handleDisconnect, setupHeartbeat } from './presence.js';
import { handleSignaling } from './signaling.js';
import { handleCalls } from './calls.js';
import { handleTranscription } from './transcription.js';
import pool from '../db.js';
import redisClient from '../redis.js';

let ioInstance = null;

/**
 * Return the Socket.IO server instance (available after setupSocket is called).
 */
export function getIO() {
  return ioInstance;
}

/**
 * Parse a raw Cookie header string and return an object of key-value pairs.
 */
function parseCookies(cookieHeader) {
  const cookies = {};

  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((pair) => {
    const [name, ...rest] = pair.trim().split('=');
    if (name) {
      cookies[name.trim()] = decodeURIComponent(rest.join('=').trim());
    }
  });

  return cookies;
}

/**
 * Create and configure a Socket.IO server attached to the given HTTP server.
 * Handles authentication, presence, signaling, and call events.
 *
 * @param {import('http').Server} server - Node HTTP server instance
 * @returns {Server} The Socket.IO server instance
 */
export function setupSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
      credentials: true,
    },
  });

  ioInstance = io;

  // ------- Authentication middleware -------
  io.use((socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      const cookies = parseCookies(cookieHeader);
      const token = cookies.token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = verifyToken(token);

      if (!decoded) {
        return next(new Error('Invalid or expired token'));
      }

      // Attach userId to the socket for use in handlers
      socket.userId = decoded.userId;
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  // ------- Connection handler -------
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (user: ${socket.userId})`);

    // Register presence
    handleConnect(io, socket, redisClient);

    // Register heartbeat
    setupHeartbeat(io, socket, redisClient);

    // Register signaling handlers
    handleSignaling(io, socket);

    // Register call handlers
    handleCalls(io, socket, pool, redisClient);

    // Register transcription handlers
    handleTranscription(io, socket);

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id} (user: ${socket.userId})`);
      handleDisconnect(io, socket, redisClient);
    });
  });

  return io;
}
