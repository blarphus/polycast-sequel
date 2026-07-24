function frequencyBand(column) {
  return `CASE
    WHEN ${column} <= 500 THEN 10
    WHEN ${column} <= 1000 THEN 9
    WHEN ${column} <= 2000 THEN 8
    WHEN ${column} <= 4000 THEN 7
    WHEN ${column} <= 7000 THEN 6
    WHEN ${column} <= 12000 THEN 5
    WHEN ${column} <= 20000 THEN 4
    WHEN ${column} <= 35000 THEN 3
    WHEN ${column} <= 60000 THEN 2
    ELSE 1
  END`;
}

export async function up(client) {
  for (const table of ['saved_words', 'shared_dictionary_entries']) {
    await client.query(`
      UPDATE ${table}
         SET frequency = ${frequencyBand('lemma_frequency_rank')}
       WHERE lemma_frequency_rank IS NOT NULL
         AND frequency IS DISTINCT FROM ${frequencyBand('lemma_frequency_rank')}
    `);
  }

  await client.query(`
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY user_id, target_language
               ORDER BY priority DESC,
                        lemma_frequency_rank ASC NULLS LAST,
                        frequency DESC NULLS LAST,
                        frequency_count DESC NULLS LAST,
                        sense_rank ASC NULLS LAST,
                        created_at ASC,
                        id
             ) - 1 AS position
        FROM saved_words
       WHERE srs_interval = 0
         AND learning_step IS NULL
         AND last_reviewed_at IS NULL
    )
    UPDATE saved_words sw
       SET queue_position = ranked.position
      FROM ranked
     WHERE sw.id = ranked.id
       AND sw.queue_position IS DISTINCT FROM ranked.position
  `);

  const { rows: dirtySchedules } = await client.query(
    `SELECT user_id
       FROM user_schedule_state
      WHERE schedule_version IS DISTINCT FROM scheduled_version
      ORDER BY user_id`,
  );
  for (const { user_id: userId } of dirtySchedules) {
    await ensureScheduleCurrent(client, userId, 'UTC', { withinTransaction: true });
  }
}
import { ensureScheduleCurrent } from '../lib/dictionaryScheduleQueries.js';
