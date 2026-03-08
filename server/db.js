import pg from 'pg';
import logger from './logger.js';

const { Pool } = pg;

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
};

// Render's PostgreSQL requires SSL in production
if (process.env.NODE_ENV === 'production') {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

// Ensure every connection uses a consistent search_path.
// Includes friendkeeper schema so FriendKeeper routes work with unqualified table names,
// and public for Polycast tables. (Migration 014 previously poisoned the search_path.)
pool.on('connect', (client) => {
  client.query('SET search_path TO public, friendkeeper');
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

export default pool;
