import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import logger from './logger.js';
import crypto from 'crypto';

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
      checksum   TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;
  `);

  // 2. Load already-applied versions
  const { rows: appliedRows } = await pool.query(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
  );
  const applied = new Set(appliedRows.map((r) => r.version));

  // 3. Discover migration files
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.js') && /^\d{3}-/.test(f))
    .sort();
  const manifest = files.map((file) => ({
    file,
    version: parseInt(file.slice(0, 3), 10),
    checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsDir, file))).digest('hex'),
  }));
  validateMigrationManifest(manifest);

  for (const row of appliedRows) {
    const current = manifest.find((entry) => entry.version === row.version);
    if (!current) throw new Error(`Applied migration ${row.version} (${row.name}) is missing from the repository`);
    if (row.name !== current.file) throw new Error(`Migration ${row.version} was renamed from ${row.name} to ${current.file}`);
    if (row.checksum && row.checksum !== current.checksum) {
      throw new Error(`Applied migration ${current.file} was modified after application`);
    }
    if (!row.checksum) {
      await pool.query('UPDATE schema_migrations SET checksum = $1 WHERE version = $2', [current.checksum, row.version]);
    }
  }

  // 4. Detect existing database that pre-dates the runner
  //    (has `users` table but no migrations recorded yet)
  if (applied.size === 0) {
    const baselineTables = [
      'users', 'calls', 'friendships', 'saved_words', 'transcript_entries',
      'messages', 'classroom_students', 'stream_posts', 'stream_post_words',
      'stream_word_known', 'stream_word_list_completions', 'stream_topics',
      'videos', 'group_calls', 'group_call_participants',
    ];
    const { rows: tableCheck } = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)
    `, [baselineTables]);

    if (tableCheck.length === baselineTables.length) {
      // Mark baseline as applied without running it
      const baselineFile = files.find((f) => f.startsWith('001-'));
      if (baselineFile) {
        const version = parseInt(baselineFile.slice(0, 3), 10);
        await pool.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [version, baselineFile, manifest.find((entry) => entry.version === version).checksum],
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
      const checksum = manifest.find((entry) => entry.version === version).checksum;
      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [version, file, checksum],
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

export function validateMigrationManifest(manifest) {
  const seen = new Set();
  for (let index = 0; index < manifest.length; index += 1) {
    const entry = manifest[index];
    if (seen.has(entry.version)) throw new Error(`Duplicate migration version ${entry.version}`);
    seen.add(entry.version);
    const expected = index + 1;
    if (entry.version !== expected) {
      throw new Error(`Migration sequence gap: expected ${String(expected).padStart(3, '0')}, found ${entry.file}`);
    }
    if (!/^[a-f0-9]{64}$/.test(entry.checksum)) throw new Error(`Invalid checksum for ${entry.file}`);
  }
}
