import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pool from '../db.js';
import { migrate } from '../migrate.js';

if (process.argv.includes('--help')) {
  console.log('Usage: DATABASE_URL=... node server/scripts/legacyMigrationSmoke.js\nBuilds the legacy v30 schema, upgrades it, and checks invariants. Use only with a disposable database.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for legacy migration smoke testing');

const migrationsDirectory = path.resolve('migrations');
const legacyFiles = fs.readdirSync(migrationsDirectory)
  .filter((file) => /^\d{3}-.*\.js$/.test(file) && Number(file.slice(0, 3)) <= 30)
  .sort();

try {
  await pool.query(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  for (const file of legacyFiles) {
    const source = fs.readFileSync(path.join(migrationsDirectory, file));
    const checksum = crypto.createHash('sha256').update(source).digest('hex');
    const migration = await import(pathToFileURL(path.join(migrationsDirectory, file)).href);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await migration.up(client);
      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [Number(file.slice(0, 3)), file, checksum],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  await migrate(pool);
  const { rows: [state] } = await pool.query(`
    SELECT
      COUNT(*)::int AS migration_count,
      to_regclass('public.auth_sessions') IS NOT NULL AS auth_sessions,
      to_regclass('public.profile_sessions') IS NOT NULL AS profile_sessions,
      to_regclass('public.user_schedule_state') IS NOT NULL AS user_schedule_state,
      to_regclass('public.idempotency_requests') IS NOT NULL AS idempotency_requests
    FROM schema_migrations
  `);
  if (state.migration_count !== 35 || !state.auth_sessions || !state.profile_sessions || !state.user_schedule_state || !state.idempotency_requests) {
    throw new Error(`Legacy upgrade invariants failed: ${JSON.stringify(state)}`);
  }
  console.log(JSON.stringify({ event: 'legacy_migration_smoke_passed', ...state }));
} finally {
  await pool.end();
}
