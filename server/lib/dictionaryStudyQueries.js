const NEW_TODAY_ORDER_BY = `
  sw.priority DESC,
  sw.lemma_frequency_rank ASC NULLS LAST,
  sw.frequency DESC NULLS LAST,
  sw.frequency_count DESC NULLS LAST,
  sw.sense_rank ASC NULLS LAST,
  sw.queue_position ASC NULLS LAST,
  sw.created_at ASC,
  sw.id ASC
`;

const DUE_QUEUE_ORDER_BY = `
  CASE WHEN learning_step IS NOT NULL THEN 0
       WHEN due_at IS NOT NULL THEN 1
       ELSE 2 END,
  due_at ASC NULLS LAST,
  CASE WHEN due_at IS NULL AND priority = true THEN 0 ELSE 1 END ASC,
  sense_rank ASC NULLS LAST,
  lemma_frequency_rank ASC NULLS LAST,
  created_at ASC
`;

import { interleaveStudyQueueRows } from './dictionaryGroupQueries.js';
export async function listNewTodayWords(db, userId, timeZone = 'UTC') {
  return db.query(
    `WITH prefs AS (
       SELECT target_language, daily_new_limit
       FROM users
       WHERE id = $1
     ),
     introduced_today AS (
       SELECT COUNT(*)::int AS cnt
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.introduced_date = (NOW() AT TIME ZONE $2)::date
     )
     SELECT sw.*
     FROM saved_words sw
     CROSS JOIN prefs p
     WHERE sw.user_id = $1
       AND sw.target_language IS NOT DISTINCT FROM p.target_language
       AND sw.srs_interval = 0
       AND sw.learning_step IS NULL
       AND sw.last_reviewed_at IS NULL
     ORDER BY ${NEW_TODAY_ORDER_BY}
     LIMIT GREATEST(COALESCE((SELECT daily_new_limit FROM prefs), 0) - (SELECT cnt FROM introduced_today), 0)`,
    [userId, timeZone],
  );
}

async function queryNewWordPreview(db, userId, limit = 10) {
  return db.query(
    `WITH prefs AS (
       SELECT target_language
       FROM users
       WHERE id = $1
     )
     SELECT sw.*
     FROM saved_words sw
     CROSS JOIN prefs p
     WHERE sw.user_id = $1
       AND sw.target_language IS NOT DISTINCT FROM p.target_language
       AND sw.srs_interval = 0
       AND sw.learning_step IS NULL
       AND sw.last_reviewed_at IS NULL
     ORDER BY ${NEW_TODAY_ORDER_BY}
     LIMIT $2`,
    [userId, limit],
  );
}

async function queryWidgetWordPreview(db, userId, limit = 20) {
  return db.query(
    `WITH prefs AS (
       SELECT target_language
       FROM users
       WHERE id = $1
     )
     SELECT
       sw.id,
       COALESCE(sw.word, '') AS word,
       COALESCE(sw.translation, '') AS translation,
       COALESCE(sw.definition, '') AS definition,
       sw.example_sentence,
       sw.sentence_translation,
       sw.part_of_speech,
       sw.image_url
     FROM saved_words sw
     CROSS JOIN prefs p
     WHERE sw.user_id = $1
       AND sw.target_language IS NOT DISTINCT FROM p.target_language
       AND sw.srs_interval = 0
       AND sw.learning_step IS NULL
       AND sw.last_reviewed_at IS NULL
     ORDER BY ${NEW_TODAY_ORDER_BY}
     LIMIT $2`,
    [userId, limit],
  );
}

export async function listNewWordPreview(db, userId, limit = 10, timeZone = 'UTC') {
  void timeZone;
  return queryNewWordPreview(db, userId, limit);
}

export async function listDueWords(db, userId, timeZone = 'UTC', newLimitOverride = null, limit = null, offset = 0) {
  const result = await db.query(
    `WITH prefs AS (
       SELECT target_language, COALESCE($3::int, daily_new_limit) AS daily_new_limit
       FROM users
       WHERE id = $1
     ),
     introduced_today AS (
       SELECT COUNT(*)::int AS cnt
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.introduced_date = (NOW() AT TIME ZONE $2)::date
     ),
     review_cards AS (
       SELECT sw.*
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND (
           (sw.learning_step IS NOT NULL AND sw.due_at <= NOW() + INTERVAL '20 minutes')
           OR (
             sw.learning_step IS NULL
             AND sw.last_reviewed_at IS NOT NULL
             AND sw.due_at <= NOW()
           )
         )
     ),
     new_cards AS (
       SELECT sw.*
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.srs_interval = 0
         AND sw.learning_step IS NULL
         AND sw.last_reviewed_at IS NULL
       ORDER BY ${NEW_TODAY_ORDER_BY}
       LIMIT GREATEST(COALESCE((SELECT daily_new_limit FROM prefs), 0) - (SELECT cnt FROM introduced_today), 0)
     )
     SELECT *
     FROM (
       SELECT * FROM review_cards
       UNION ALL
       SELECT * FROM new_cards
     ) queue_words
     ORDER BY ${DUE_QUEUE_ORDER_BY}`,
    [userId, timeZone, newLimitOverride],
  );
  result.rows = interleaveStudyQueueRows(result.rows);
  if (limit !== null || offset > 0) {
    const start = Math.max(0, offset);
    const end = limit === null ? undefined : start + Math.max(0, limit);
    result.rows = result.rows.slice(start, end);
  }
  return result;
}

/**
 * Counts for the practice start screen: reviews/learning due now, the pool of
 * never-introduced cards available, and the user's current daily-new limit.
 * The `due` predicate mirrors listDueWords so the count matches the session.
 */
async function queryStudyOverview(db, userId, timeZone = 'UTC') {
  const { rows } = await db.query(
    `WITH prefs AS (
       SELECT target_language, daily_new_limit FROM users WHERE id = $1
     ),
     introduced_today AS (
       SELECT COUNT(*)::int AS cnt
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.introduced_date = (NOW() AT TIME ZONE $2)::date
     ),
     new_remaining AS (
       SELECT COUNT(*)::int AS cnt
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.srs_interval = 0
         AND sw.learning_step IS NULL
         AND sw.last_reviewed_at IS NULL
     )
     SELECT
       (SELECT COUNT(*)::int FROM saved_words sw CROSS JOIN prefs p
          WHERE sw.user_id = $1
            AND sw.target_language IS NOT DISTINCT FROM p.target_language
            AND (
              (sw.learning_step IS NOT NULL AND sw.due_at <= NOW() + INTERVAL '20 minutes')
              OR (
                sw.learning_step IS NULL
                AND sw.last_reviewed_at IS NOT NULL
                AND sw.due_at <= NOW()
              )
            )) AS due,
       LEAST(
         (SELECT cnt FROM new_remaining),
         GREATEST(COALESCE((SELECT daily_new_limit FROM prefs), 0) - (SELECT cnt FROM introduced_today), 0)
       )::int AS new_available,
       (SELECT COALESCE(daily_new_limit, 0) FROM prefs) AS daily_new_limit`,
    [userId, timeZone],
  );
  return rows[0] || { due: 0, new_available: 0, daily_new_limit: 0 };
}

export async function listStudyOverview(db, userId, timeZone = 'UTC') {
  return queryStudyOverview(db, userId, timeZone);
}

export async function listWidgetPreview(db, userId, limit = 20, timeZone = 'UTC') {
  const [overview, previewResult] = await Promise.all([
    queryStudyOverview(db, userId, timeZone),
    queryWidgetWordPreview(db, userId, limit),
  ]);
  return { overview, words: previewResult.rows };
}
