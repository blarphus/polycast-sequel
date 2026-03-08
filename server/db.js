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

// Ensure every connection from the pool uses the public schema by default.
// (Migration 014 set search_path to 'friendkeeper' on a pooled connection,
// which persisted and caused queries to fail to find public tables.)
pool.on('connect', (client) => {
  client.query('SET search_path TO public');
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

export default pool;
