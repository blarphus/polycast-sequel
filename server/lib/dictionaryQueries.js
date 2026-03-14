const NEW_TODAY_ORDER_BY = `
  sw.priority DESC,
  sw.frequency DESC NULLS LAST,
  sw.created_at ASC,
  sw.queue_position ASC NULLS LAST
`;

const DUE_QUEUE_ORDER_BY = `
  CASE WHEN learning_step IS NOT NULL THEN 0
       WHEN due_at IS NOT NULL THEN 1
       ELSE 2 END,
  due_at ASC NULLS LAST,
  CASE WHEN due_at IS NULL AND priority = true THEN 0 ELSE 1 END ASC,
  frequency DESC NULLS LAST,
  created_at ASC
`;

export async function listNewTodayWords(db, userId) {
  return db.query(
    `WITH prefs AS (
       SELECT target_language, daily_new_limit
       FROM users
       WHERE id = $1
     )
     SELECT sw.*
     FROM saved_words sw
     CROSS JOIN prefs p
     WHERE sw.user_id = $1
       AND sw.target_language IS NOT DISTINCT FROM p.target_language
       AND sw.due_at IS NULL
       AND sw.last_reviewed_at IS NULL
     ORDER BY ${NEW_TODAY_ORDER_BY}
     LIMIT COALESCE((SELECT daily_new_limit FROM prefs), 0)`,
    [userId],
  );
}

export async function listDueWords(db, userId) {
  return db.query(
    `WITH prefs AS (
       SELECT target_language, daily_new_limit
       FROM users
       WHERE id = $1
     ),
     due_cards AS (
       SELECT sw.*
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.due_at <= NOW()
     ),
     new_cards AS (
       SELECT sw.*
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.due_at IS NULL
         AND sw.last_reviewed_at IS NULL
       ORDER BY ${NEW_TODAY_ORDER_BY}
       LIMIT COALESCE((SELECT daily_new_limit FROM prefs), 0)
     )
     SELECT *
     FROM (
       SELECT * FROM due_cards
       UNION ALL
       SELECT * FROM new_cards
     ) queue_words
     ORDER BY ${DUE_QUEUE_ORDER_BY}`,
    [userId],
  );
}
