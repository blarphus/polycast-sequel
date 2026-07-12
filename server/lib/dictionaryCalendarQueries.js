export async function listCalendarCounts(db, userId, year, month, timeZone = 'UTC') {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  // First day of next month
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const { rows: dayCounts } = await db.query(
    `WITH prefs AS (
       SELECT target_language, COALESCE(daily_new_limit, 0) AS daily_new_limit
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
     review_due AS (
       SELECT (sw.due_at AT TIME ZONE $2)::date AS date
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.due_at IS NOT NULL
         AND (sw.due_at AT TIME ZONE $2)::date >= $3::date
         AND (sw.due_at AT TIME ZONE $2)::date < $4::date
     ),
     new_due AS (
       SELECT (
         date_trunc('day', NOW() AT TIME ZONE $2)
         + make_interval(days => FLOOR(((COALESCE(sw.queue_position, 2147483647) + (SELECT cnt FROM introduced_today))::numeric) / NULLIF((SELECT daily_new_limit FROM prefs), 0))::int)
       )::date AS date
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND (SELECT daily_new_limit FROM prefs) > 0
         AND sw.srs_interval = 0
         AND sw.learning_step IS NULL
         AND sw.last_reviewed_at IS NULL
     )
     SELECT date, COUNT(*)::int AS count
     FROM (
       SELECT date FROM review_due
       UNION ALL
       SELECT date FROM new_due
       WHERE date >= $3::date AND date < $4::date
     ) due_dates
     GROUP BY date
     ORDER BY date`,
    [userId, timeZone, startDate, endDate],
  );

  const { rows: newRows } = await db.query(
    `WITH prefs AS (
       SELECT target_language, COALESCE(daily_new_limit, 0) AS daily_new_limit
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
     SELECT COUNT(*)::int AS count
     FROM saved_words sw
     CROSS JOIN prefs p
     WHERE sw.user_id = $1
       AND sw.target_language IS NOT DISTINCT FROM p.target_language
       AND (SELECT daily_new_limit FROM prefs) > 0
       AND sw.srs_interval = 0
       AND sw.learning_step IS NULL
       AND sw.last_reviewed_at IS NULL
       AND FLOOR(((COALESCE(sw.queue_position, 2147483647) + (SELECT cnt FROM introduced_today))::numeric) / NULLIF((SELECT daily_new_limit FROM prefs), 0))::int = 0`,
    [userId, timeZone],
  );

  return {
    days: dayCounts.map((r) => ({ date: r.date, count: r.count })),
    newToday: newRows[0]?.count ?? 0,
  };
}

export async function listCalendarDayWords(db, userId, date, timeZone = 'UTC') {
  const { rows } = await db.query(
    `WITH prefs AS (
       SELECT target_language, COALESCE(daily_new_limit, 0) AS daily_new_limit
       FROM users
       WHERE id = $1
     ),
     introduced_today AS (
       SELECT COUNT(*)::int AS cnt
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.introduced_date = (NOW() AT TIME ZONE $3)::date
     ),
     review_cards AS (
       SELECT sw.*, (sw.due_at AT TIME ZONE $3)::date AS calendar_due_date, sw.due_at AS sort_due_at
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.due_at IS NOT NULL
         AND (sw.due_at AT TIME ZONE $3)::date = $2::date
     ),
     new_cards AS (
       SELECT
         sw.*,
         (
           date_trunc('day', NOW() AT TIME ZONE $3)
           + make_interval(days => FLOOR(((COALESCE(sw.queue_position, 2147483647) + (SELECT cnt FROM introduced_today))::numeric) / NULLIF((SELECT daily_new_limit FROM prefs), 0))::int)
         )::date AS calendar_due_date,
         NULL::timestamptz AS sort_due_at
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND (SELECT daily_new_limit FROM prefs) > 0
         AND sw.srs_interval = 0
         AND sw.learning_step IS NULL
         AND sw.last_reviewed_at IS NULL
     )
     SELECT *
     FROM (
       SELECT * FROM review_cards
       UNION ALL
       SELECT * FROM new_cards WHERE calendar_due_date = $2::date
     ) day_words
     ORDER BY sort_due_at ASC NULLS LAST, queue_position ASC NULLS LAST`,
    [userId, date, timeZone],
  );
  return rows;
}
