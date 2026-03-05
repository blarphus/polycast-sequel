import 'dotenv/config';

import crypto from 'crypto';
import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import pinoHttp from 'pino-http';
import logger from './logger.js';

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
import streamPostsRoutes from './routes/stream-posts.js';
import streamTopicsRoutes from './routes/stream-topics.js';
import streamWordsRoutes from './routes/stream-words.js';
import videosRoutes from './routes/videos.js';
import templatesRoutes from './routes/templates.js';
import groupClassRoutes from './routes/groupClass.js';
import placementRoutes from './routes/placement.js';
import newsRoutes from './routes/news.js';
import practiceRoutes from './routes/practice.js';
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
    logger.error({ err }, 'Failed to run migrations. Exiting.');
    process.exit(1);
  }

  // ------ Redis connection ------
  try {
    await redisClient.connect();
    // Flush stale video caches so new Shorts filters take effect immediately
    const videoCacheKeys = await redisClient.keys('trending:*');
    for (const prefix of ['trending2:*', 'channel3:*', 'search:*', 'lessons2:*', 'lesson2:*']) {
      videoCacheKeys.push(...await redisClient.keys(prefix));
    }
    if (videoCacheKeys.length > 0) {
      await redisClient.del(videoCacheKeys);
      logger.info(`Flushed ${videoCacheKeys.length} video cache key(s) on startup`);
    }
    transcriptWorker = await startTranscriptWorker({ redisClient, pool });
    backfillCefrLevels(pool).catch((err) => logger.error({ err }, '[cefr-backfill] Error'));
  } catch (err) {
    logger.error({ err }, 'Failed to connect to Redis (will retry in background)');
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

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // ------ Structured request logging ------
  app.use(pinoHttp({
    logger,
    genReqId: () => crypto.randomUUID(),
    autoLogging: {
      ignore: (req) => {
        const p = req.url || '';
        return p.startsWith('/assets/') || p.endsWith('.js') || p.endsWith('.css');
      },
    },
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));

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
  app.use(streamPostsRoutes);
  app.use(streamTopicsRoutes);
  app.use(streamWordsRoutes);
  app.use(videosRoutes);
  app.use(templatesRoutes);
  app.use(groupClassRoutes);
  app.use(placementRoutes);
  app.use(newsRoutes);
  app.use(practiceRoutes);

  // ------ SPA fallback ------
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  // ------ Global error handler (always return JSON, never HTML) ------
  app.use((err, req, res, _next) => {
    (req.log || logger).error({ err }, 'Unhandled server error');
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  // ------ HTTP + Socket.IO server ------
  const server = http.createServer(app);
  const io = setupSocket(server);

  server.listen(PORT, () => {
    logger.info(`Polycast Sequel server listening on port ${PORT}`);
  });

  // ------ Graceful shutdown ------
  const shutdown = async () => {
    logger.info('Shutting down...');
    io.close();
    try { await transcriptWorker?.stop(); } catch (err) { logger.error({ err }, 'Transcript worker stop error during shutdown'); }
    try { await redisClient.quit(); } catch (err) { logger.error({ err }, 'Redis quit error during shutdown'); }
    try { await pool.end(); } catch (err) { logger.error({ err }, 'Pool end error during shutdown'); }
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => { process.exit(1); }, 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});

main();
