import { createClient } from 'redis';

const url = process.env.REDIS_URL || 'redis://localhost:6379';

const opts = { url };

// Render's Redis uses rediss:// (TLS) — allow self-signed certs
if (url.startsWith('rediss://')) {
  opts.socket = { tls: true, rejectUnauthorized: false };
}

const redisClient = createClient(opts);

redisClient.on('error', (err) => {
  console.error('Redis client error:', err);
});

redisClient.on('connect', () => {
  console.log('Redis client connected');
});

redisClient.on('reconnecting', () => {
  console.log('Redis client reconnecting...');
});

export default redisClient;
