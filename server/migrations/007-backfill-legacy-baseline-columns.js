/**
 * 007-backfill-legacy-baseline-columns — repair older databases that predate
 * parts of the baseline schema but were marked as already migrated.
 */

export async function up(client) {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS cefr_level VARCHAR(2) DEFAULT NULL
  `);

  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS cefr_levels JSONB DEFAULT '{}'::jsonb
  `);

  await client.query(`
    UPDATE users
    SET cefr_levels = jsonb_set('{}'::jsonb, ARRAY[target_language], to_jsonb(cefr_level))
    WHERE cefr_level IS NOT NULL
      AND target_language IS NOT NULL
      AND (cefr_levels IS NULL OR cefr_levels = '{}'::jsonb)
  `);

  await client.query(`
    ALTER TABLE videos
      ADD COLUMN IF NOT EXISTS cefr_level VARCHAR(2) DEFAULT NULL
  `);
}
