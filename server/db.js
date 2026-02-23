import pg from 'pg';

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
  console.error('Unexpected PostgreSQL pool error:', err);
});

export default pool;
