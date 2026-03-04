import { createClient } from 'redis';
import logger from './logger.js';

const url = process.env.REDIS_URL || 'redis://localhost:6379';

const opts = { url };

// Render's Redis uses rediss:// (TLS) — allow self-signed certs
if (url.startsWith('rediss://')) {
  opts.socket = { tls: true, rejectUnauthorized: false };
}

const redisClient = createClient(opts);

redisClient.on('error', (err) => {
  logger.error({ err }, 'Redis client error');
});

redisClient.on('connect', () => {
  logger.info('Redis client connected');
});

redisClient.on('reconnecting', () => {
  logger.info('Redis client reconnecting...');
});

export default redisClient;
