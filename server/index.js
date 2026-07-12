import 'dotenv/config';

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import pool from './db.js';
import logger from './logger.js';
import { migrate } from './migrate.js';
import redisClient from './redis.js';
import { setupSocket } from './socket/index.js';
import { backfillCefrLevels, startTranscriptWorker } from './services/videoTranscriptQueue.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 3001;

async function main() {
  await migrate(pool);

  await redisClient.connect();
  logger.info({ cacheVersion: process.env.CACHE_VERSION || 'v1' }, 'Redis cache namespace ready');
  const transcriptWorker = await startTranscriptWorker({ redisClient, pool });
  backfillCefrLevels(pool).catch((err) => logger.error({ err }, 'CEFR backfill failed'));

  const server = http.createServer(createApp({ clientDist: path.resolve(root, '..', 'client', 'dist') }));
  const io = setupSocket(server);
  server.listen(port, () => logger.info({ port }, 'Polycast server listening'));

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const forcedExit = setTimeout(() => process.exit(1), 5_000);
    forcedExit.unref();
    try { await transcriptWorker?.stop(); } catch (err) { logger.error({ err }, 'Transcript worker stop failed'); }
    try { await redisClient.quit(); } catch (err) { logger.error({ err }, 'Redis quit failed'); }
    io.close();
    server.close(async () => {
      try { await pool.end(); } catch (err) { logger.error({ err }, 'PostgreSQL pool shutdown failed'); }
      clearTimeout(forcedExit);
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => logger.fatal({ err: reason }, 'Unhandled rejection'));
main().catch((err) => {
  logger.fatal({ err }, 'Server startup failed');
  process.exit(1);
});
