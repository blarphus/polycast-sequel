export async function ensureCardsScheduled(db, userId, timeZone = 'UTC') {
  await db.query(
    `WITH prefs AS (
       SELECT target_language
       FROM users
       WHERE id = $1
     ),
     ranked AS (
       SELECT sw.id,
              ROW_NUMBER() OVER (
                ORDER BY sw.priority DESC,
                         sw.frequency_count DESC NULLS LAST,
                         sw.frequency DESC NULLS LAST,
                         sw.lemma_frequency_rank ASC NULLS LAST,
                         sw.sense_rank ASC NULLS LAST,
                         sw.created_at ASC,
                         sw.id
              ) - 1 AS new_position
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.srs_interval = 0
         AND sw.learning_step IS NULL
         AND sw.last_reviewed_at IS NULL
     )
     UPDATE saved_words sw
     SET queue_position = ranked.new_position
     FROM ranked
     WHERE sw.id = ranked.id
       AND sw.queue_position IS DISTINCT FROM ranked.new_position`,
    [userId],
  );

  await db.query(
    `UPDATE saved_words sw
     SET due_at = NULL
     FROM users u
     WHERE sw.user_id = $1
       AND u.id = sw.user_id
       AND sw.target_language IS NOT DISTINCT FROM u.target_language
       AND sw.srs_interval = 0
       AND sw.learning_step IS NULL
       AND sw.last_reviewed_at IS NULL
       AND sw.due_at IS NOT NULL`,
    [userId],
  );

  await db.query(
    `UPDATE saved_words sw
     SET due_at = CASE
       WHEN sw.last_reviewed_at IS NOT NULL AND GREATEST(COALESCE(sw.srs_interval, 0), 0) >= 86400 THEN (
         date_trunc('day', sw.last_reviewed_at AT TIME ZONE $2)
         + make_interval(days => GREATEST(CEIL(COALESCE(sw.srs_interval, 0)::numeric / 86400), 1)::int)
       ) AT TIME ZONE $2
       WHEN sw.last_reviewed_at IS NOT NULL THEN sw.last_reviewed_at + make_interval(secs => GREATEST(COALESCE(sw.srs_interval, 0), 60))
       ELSE COALESCE(sw.created_at, NOW())
     END
     FROM users u
     WHERE sw.user_id = $1
       AND u.id = sw.user_id
       AND sw.target_language IS NOT DISTINCT FROM u.target_language
       AND sw.due_at IS NULL
       AND NOT (
         sw.srs_interval = 0
         AND sw.learning_step IS NULL
         AND sw.last_reviewed_at IS NULL
     )`,
    [userId, timeZone],
  );

  const rollover = await db.query(
    `WITH prefs AS (
       SELECT target_language
       FROM users
       WHERE id = $1
     ),
     overdue_review_cards AS (
       SELECT sw.id
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.last_reviewed_at IS NOT NULL
         AND sw.learning_step IS NULL
         AND GREATEST(COALESCE(sw.srs_interval, 0), 0) >= 86400
         AND sw.due_at IS NOT NULL
         AND (sw.due_at AT TIME ZONE $2)::date < (NOW() AT TIME ZONE $2)::date
     )
     UPDATE saved_words sw
     SET due_at = date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2
     FROM overdue_review_cards overdue
     WHERE sw.id = overdue.id`,
    [userId, timeZone],
  );
  return rollover.rowCount ?? 0;
}

/**
 * Repair scheduling only when a mutation marked it dirty or the user's local
 * calendar day changed. The advisory transaction lock guarantees concurrent
 * readers cannot run duplicate repairs.
 */
export async function ensureScheduleCurrent(
  db,
  userId,
  timeZone = 'UTC',
  { force = false, withinTransaction = false } = {},
) {
  const client = withinTransaction
    ? db
    : (typeof db.connect === 'function' ? await db.connect() : db);
  const shouldRelease = !withinTransaction && client !== db;
  try {
    if (!withinTransaction) await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`schedule:${userId}`]);
    const { rows: [state] } = await client.query(
      `SELECT schedule_version, scheduled_version, local_day,
              (NOW() AT TIME ZONE $2)::date AS current_day
       FROM user_schedule_state
       WHERE user_id = $1`,
      [userId, timeZone],
    );
    const dirty = !state || Number(state.schedule_version) !== Number(state.scheduled_version);
    const dayChanged = !state?.local_day || String(state.local_day).slice(0, 10) !== String(state.current_day).slice(0, 10);
    if (!force && !dirty && !dayChanged) {
      if (!withinTransaction) await client.query('COMMIT');
      return { used: false, reason: null, changedCount: 0 };
    }

    const changedCount = await ensureCardsScheduled(client, userId, timeZone);
    await client.query(
      `INSERT INTO user_schedule_state (
         user_id, schedule_version, scheduled_version, local_day, dirty_at, scheduled_at
       ) VALUES ($1, 0, 0, (NOW() AT TIME ZONE $2)::date, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         scheduled_version = user_schedule_state.schedule_version,
         local_day = EXCLUDED.local_day,
         scheduled_at = NOW()`,
      [userId, timeZone],
    );
    if (!withinTransaction) await client.query('COMMIT');
    return {
      used: true,
      reason: force ? 'explicit-mutation' : (dirty ? 'dirty-mutation' : 'local-day-boundary'),
      changedCount,
    };
  } catch (error) {
    if (!withinTransaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
}
