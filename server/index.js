import 'dotenv/config';

import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import pool from './db.js';
import redisClient from './redis.js';
import { migrate } from './migrate.js';
import { setupSocket } from './socket/index.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import friendsRoutes from './routes/friends.js';
import dictionaryRoutes from './routes/dictionary.js';
import messagesRoutes from './routes/messages.js';
import classroomRoutes from './routes/classroom.js';
import iceServersRoutes from './routes/iceServers.js';
import streamRoutes from './routes/stream.js';
import videosRoutes from './routes/videos.js';
import { startTranscriptWorker, backfillCefrLevels } from './services/videoTranscriptQueue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const ALLOWED_ORIGINS = [
  CLIENT_ORIGIN,
  process.env.EXTENSION_ORIGIN,
].filter(Boolean);

async function main() {
  let transcriptWorker = null;

  // ------ Database migrations ------
  try {
    await migrate(pool);
  } catch (err) {
    console.error('Failed to run migrations. Exiting.', err);
    process.exit(1);
  }

  // ------ Redis connection ------
  try {
    await redisClient.connect();
    transcriptWorker = await startTranscriptWorker({ redisClient, pool });
    backfillCefrLevels(pool).catch((err) => console.error('[cefr-backfill] Error:', err.message));
  } catch (err) {
    console.error('Failed to connect to Redis (will retry in background):', err.message);
  }

  // ------ Express app ------
  const app = express();

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.startsWith('chrome-extension://')) {
        callback(null, true);
      } else {
        // Don't error — just skip CORS headers. Same-origin requests
        // still work (Vite's crossorigin attribute on assets sends Origin
        // but the browser allows same-origin responses without CORS headers).
        callback(null, false);
      }
    },
    credentials: true,
  }));

  app.use(express.json());
  app.use(cookieParser());

  // Serve client build assets
  const clientDist = path.resolve(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));

  // ------ API routes ------
  app.use(authRoutes);
  app.use(usersRoutes);
  app.use(friendsRoutes);
  app.use(dictionaryRoutes);
  app.use(messagesRoutes);
  app.use(classroomRoutes);
  app.use(iceServersRoutes);
  app.use(streamRoutes);
  app.use(videosRoutes);

  // ------ SPA fallback ------
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  // ------ Global error handler (always return JSON, never HTML) ------
  app.use((err, _req, res, _next) => {
    console.error('Unhandled server error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  // ------ HTTP + Socket.IO server ------
  const server = http.createServer(app);
  const io = setupSocket(server);

  server.listen(PORT, () => {
    console.log(`Polycast Sequel server listening on port ${PORT}`);
  });

  // ------ Graceful shutdown ------
  const shutdown = async () => {
    console.log('\nShutting down...');
    io.close();
    try { await transcriptWorker?.stop(); } catch (err) { console.error('Transcript worker stop error during shutdown:', err); }
    try { await redisClient.quit(); } catch (err) { console.error('Redis quit error during shutdown:', err); }
    try { await pool.end(); } catch (err) { console.error('Pool end error during shutdown:', err); }
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
    setTimeout(() => { process.exit(1); }, 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

main();
