import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Versioned migration runner.
 *
 * 1. Creates `schema_migrations` table if it doesn't exist.
 * 2. Detects existing databases (has `users` table but no recorded migrations)
 *    and marks the baseline as applied without re-running it.
 * 3. Reads `server/migrations/*.js` sorted by 3-digit version prefix.
 * 4. Runs each pending migration inside its own BEGIN/COMMIT.
 * 5. Records each completed migration in `schema_migrations`.
 */
export async function migrate(pool) {
  // 1. Ensure the schema_migrations table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 2. Load already-applied versions
  const { rows: appliedRows } = await pool.query(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  const applied = new Set(appliedRows.map((r) => r.version));

  // 3. Discover migration files
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.js') && /^\d{3}-/.test(f))
    .sort();

  // 4. Detect existing database that pre-dates the runner
  //    (has `users` table but no migrations recorded yet)
  if (applied.size === 0) {
    const { rows: tableCheck } = await pool.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    `);

    if (tableCheck.length > 0) {
      // Mark baseline as applied without running it
      const baselineFile = files.find((f) => f.startsWith('001-'));
      if (baselineFile) {
        const version = parseInt(baselineFile.slice(0, 3), 10);
        await pool.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [version, baselineFile],
        );
        applied.add(version);
        logger.info(`Baseline migration ${baselineFile} marked as applied (existing database detected)`);
      }
    }
  }

  // 5. Run pending migrations
  let ranCount = 0;

  for (const file of files) {
    const version = parseInt(file.slice(0, 3), 10);
    if (applied.has(version)) continue;

    const modulePath = pathToFileURL(path.join(migrationsDir, file)).href;
    const mod = await import(modulePath);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await mod.up(client);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [version, file],
      );
      await client.query('COMMIT');
      logger.info(`Migration ${file} applied`);
      ranCount++;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err }, `Migration ${file} failed`);
      throw err;
    } finally {
      client.release();
    }
  }

  if (ranCount === 0) {
    logger.info('Database migrations up to date');
  } else {
    logger.info(`${ranCount} migration(s) applied successfully`);
  }
}
