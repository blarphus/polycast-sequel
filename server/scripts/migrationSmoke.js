import pool from '../db.js';
import { getMigrationManifest, migrate } from '../migrate.js';

if (process.argv.includes('--help')) {
  console.log('Usage: DATABASE_URL=... node server/scripts/migrationSmoke.js\nApplies all migrations to a disposable database and checks schema invariants.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for migration smoke testing');

try {
  const expectedMigrationCount = getMigrationManifest().length;
  await migrate(pool);
  const { rows } = await pool.query(`
    SELECT
      to_regclass('public.users') IS NOT NULL AS users,
      to_regclass('public.saved_words') IS NOT NULL AS saved_words,
      to_regclass('public.auth_sessions') IS NOT NULL AS auth_sessions,
      to_regclass('public.profile_sessions') IS NOT NULL AS profile_sessions,
      to_regclass('public.user_schedule_state') IS NOT NULL AS user_schedule_state,
      to_regclass('public.idempotency_requests') IS NOT NULL AS idempotency_requests,
      to_regclass('public.compact_lemma_rankings') IS NOT NULL AS compact_lemma_rankings,
      to_regclass('public.compact_sense_rankings') IS NOT NULL AS compact_sense_rankings,
      to_regclass('public.frequency_catalog_build_runs') IS NOT NULL AS catalog_progress,
      to_regclass('public.dictionary_lemmas') IS NULL AS legacy_lemmas_removed,
      to_regclass('public.dictionary_senses') IS NULL AS legacy_senses_removed,
      NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'saved_words'
           AND column_name IN ('lemma_id', 'sense_id')
      ) AS legacy_saved_word_ids_removed,
      to_regclass('public.schema_migrations') IS NOT NULL AS schema_migrations,
      (SELECT COUNT(*)::int FROM schema_migrations) AS migration_count
  `);
  const result = rows[0];
  const missing = Object.entries(result).filter(([key, value]) => key !== 'migration_count' && value !== true);
  if (missing.length > 0 || result.migration_count !== expectedMigrationCount) {
    throw new Error(`Migration invariants failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ event: 'migration_smoke_passed', ...result }));
} finally {
  await pool.end();
}
