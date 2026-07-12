import pg from 'pg';
import logger from './logger.js';

const { Pool } = pg;

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  // Set this during the PostgreSQL startup handshake. Running an unawaited
  // query from Pool's `connect` event races the caller's first query and is
  // deprecated by pg 8 (and will fail under pg 9).
  options: '-c search_path=public,friendkeeper',
};

// Render's PostgreSQL requires SSL in production
if (process.env.NODE_ENV === 'production') {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

export default pool;
