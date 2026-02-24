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
import callsRoutes from './routes/calls.js';
import friendsRoutes from './routes/friends.js';
import whisperRoutes from './whisper.js';
import dictionaryRoutes from './routes/dictionary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

async function main() {
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
  } catch (err) {
    console.error('Failed to connect to Redis (will retry in background):', err.message);
  }

  // ------ Express app ------
  const app = express();

  app.use(cors({
    origin: CLIENT_ORIGIN,
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
  app.use(callsRoutes);
  app.use(friendsRoutes);
  app.use(whisperRoutes);
  app.use(dictionaryRoutes);

  // ------ SPA fallback ------
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(clientDist, 'index.html'));
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
    try { await redisClient.quit(); } catch { /* ignore */ }
    try { await pool.end(); } catch { /* ignore */ }
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
    setTimeout(() => { process.exit(1); }, 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
