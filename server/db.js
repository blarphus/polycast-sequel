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

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

export default pool;
