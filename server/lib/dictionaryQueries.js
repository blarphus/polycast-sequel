// ---------------------------------------------------------------------------
// In-memory cache for dictionary group pages (avoids re-querying + re-sorting)
// ---------------------------------------------------------------------------
const _groupCache = new Map();
const CACHE_TTL_MS = 60_000;

function _cacheKey(userId, targetLanguage, search, sort, timeZone) {
  return `${userId}:${targetLanguage}:${search}:${sort}:${timeZone}`;
}

export function invalidateDictionaryCache(userId) {
  for (const key of _groupCache.keys()) {
    if (key.startsWith(`${userId}:`)) _groupCache.delete(key);
  }
}

const NEW_TODAY_ORDER_BY = `
  sw.queue_position ASC NULLS LAST,
  sw.frequency_count DESC NULLS LAST,
  sw.frequency DESC NULLS LAST,
  sw.created_at ASC,
  sw.id ASC
`;

const DUE_QUEUE_ORDER_BY = `
  CASE WHEN learning_step IS NOT NULL THEN 0
       WHEN due_at IS NOT NULL THEN 1
       ELSE 2 END,
  due_at ASC NULLS LAST,
  CASE WHEN due_at IS NULL AND priority = true THEN 0 ELSE 1 END ASC,
  frequency_count DESC NULLS LAST,
  frequency DESC NULLS LAST,
  created_at ASC
`;

export async function ensureCardsScheduled(db, userId, timeZone = 'UTC') {
  await db.query(
    `WITH prefs AS (
       SELECT target_language
       FROM users
       WHERE id = $1
     ),
     ranked AS (
       SELECT
         sw.id,
         ROW_NUMBER() OVER (
           ORDER BY
             CASE
               WHEN sw.srs_interval = 0
                AND sw.learning_step IS NULL
                AND sw.last_reviewed_at IS NULL THEN 0
               ELSE 1
             END ASC,
             sw.frequency_count DESC NULLS LAST,
             sw.frequency DESC NULLS LAST,
             sw.created_at ASC,
             sw.id ASC
         ) - 1 AS new_position
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
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
  if ((rollover.rowCount ?? 0) > 0) invalidateDictionaryCache(userId);
}

/**
 * Fetch a user's already-saved definitions for a word and its lemma-siblings, so they can be
 * offered as candidate senses when the word is looked up again. Matches by the word itself, its
 * resolved lemma, and any saved row that shares that lemma (i.e. another inflection of the same
 * base). Used so the sense-picker can decide whether a new click is an existing sense or new.
 */
export async function fetchUserSavedSensesForWord(db, userId, targetLang, word, lemma) {
  const { rows } = await db.query(
    `SELECT id, word, definition, translation, part_of_speech, lemma, forms
       FROM saved_words
      WHERE user_id = $1
        AND target_language IS NOT DISTINCT FROM $2
        AND definition <> ''
        AND (
          LOWER(word) = LOWER($3)
          OR LOWER(lemma) = LOWER($3)
          OR ($4 <> '' AND (LOWER(word) = LOWER($4) OR LOWER(lemma) = LOWER($4)))
        )
      ORDER BY created_at DESC
      LIMIT 20`,
    [userId, targetLang || null, word, lemma || ''],
  );
  return rows;
}

export async function listNewTodayWords(db, userId, timeZone = 'UTC') {
  await ensureCardsScheduled(db, userId, timeZone);
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

export async function listNewWordPreview(db, userId, limit = 10, timeZone = 'UTC') {
  await ensureCardsScheduled(db, userId, timeZone);
  return queryNewWordPreview(db, userId, limit);
}

export async function listDueWords(db, userId, timeZone = 'UTC', newLimitOverride = null) {
  await ensureCardsScheduled(db, userId, timeZone);
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
  await ensureCardsScheduled(db, userId, timeZone);
  return queryStudyOverview(db, userId, timeZone);
}

export async function listWidgetPreview(db, userId, limit = 20, timeZone = 'UTC') {
  await ensureCardsScheduled(db, userId, timeZone);
  const [overview, previewResult] = await Promise.all([
    queryStudyOverview(db, userId, timeZone),
    queryNewWordPreview(db, userId, limit),
  ]);
  return { overview, words: previewResult.rows };
}

function isDictionaryEntryNew(word) {
  return word.srs_interval === 0 && word.learning_step === null && !word.last_reviewed_at;
}

function localDateKeyForTimeZone(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}T00:00:00`;
}

function withProjectedNewDueDates(words, dailyNewLimit, introducedToday, timeZone) {
  const limit = Math.max(0, Number(dailyNewLimit) || 0);
  if (limit <= 0) {
    return words.map((word) => (
      isDictionaryEntryNew(word) ? { ...word, projected_due_at: null } : word
    ));
  }

  const today = localDateKeyForTimeZone(timeZone);
  return words.map((word) => {
    if (!isDictionaryEntryNew(word)) return word;
    if (word.queue_position == null) return { ...word, projected_due_at: null };
    const queuePosition = word.queue_position;
    const dayOffset = Math.floor((queuePosition + introducedToday) / limit);
    return { ...word, projected_due_at: addDaysToDateKey(today, dayOffset) };
  });
}

function getCreatedTime(word) {
  return new Date(word.created_at).getTime();
}

function getDueTime(word) {
  if (!word.due_at) return Number.POSITIVE_INFINITY;
  const time = new Date(word.due_at).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function getProjectedNewTime(word) {
  const statusDate = word.projected_due_at || word.due_at;
  if (!statusDate) return Number.POSITIVE_INFINITY;
  const time = new Date(statusDate).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function compareNewEntries(a, b) {
  const dueDiff = getProjectedNewTime(a) - getProjectedNewTime(b);
  if (dueDiff !== 0) return dueDiff;

  const aQueue = a.queue_position ?? Number.POSITIVE_INFINITY;
  const bQueue = b.queue_position ?? Number.POSITIVE_INFINITY;
  if (aQueue !== bQueue) return aQueue - bQueue;

  const aPriority = a.priority ? 0 : 1;
  const bPriority = b.priority ? 0 : 1;
  if (aPriority !== bPriority) return aPriority - bPriority;

  const aFreqCount = a.frequency_count ?? 0;
  const bFreqCount = b.frequency_count ?? 0;
  if (aFreqCount !== bFreqCount) return bFreqCount - aFreqCount;

  const aFrequency = a.frequency ?? 0;
  const bFrequency = b.frequency ?? 0;
  if (aFrequency !== bFrequency) return bFrequency - aFrequency;

  const createdDiff = getCreatedTime(a) - getCreatedTime(b);
  if (createdDiff !== 0) return createdDiff;

  return aQueue - bQueue;
}

function interleaveStudyQueueRows(rows) {
  const newRows = rows.filter(isDictionaryEntryNew).sort(compareNewEntries);
  if (newRows.length === 0) return rows;

  const reviewRows = rows.filter((row) => !isDictionaryEntryNew(row));
  if (reviewRows.length === 0) return newRows;

  const reviewInterval = Math.max(Math.floor(reviewRows.length / newRows.length), 1);
  const interleaved = [];
  let reviewIndex = 0;
  let newIndex = 0;

  while (reviewIndex < reviewRows.length) {
    const nextReviewIndex = Math.min(reviewIndex + reviewInterval, reviewRows.length);
    interleaved.push(...reviewRows.slice(reviewIndex, nextReviewIndex));
    reviewIndex = nextReviewIndex;

    if (newIndex < newRows.length) {
      interleaved.push(newRows[newIndex]);
      newIndex += 1;
    }
  }

  if (newIndex < newRows.length) {
    interleaved.push(...newRows.slice(newIndex));
  }

  return interleaved;
}

function compareReviewEntries(a, b) {
  const aLearningRank = a.learning_step !== null ? 0 : 1;
  const bLearningRank = b.learning_step !== null ? 0 : 1;
  if (aLearningRank !== bLearningRank) return aLearningRank - bLearningRank;

  const aDueTime = getDueTime(a);
  const bDueTime = getDueTime(b);
  if (aDueTime !== bDueTime) return aDueTime - bDueTime;

  const aPriority = a.priority ? 0 : 1;
  const bPriority = b.priority ? 0 : 1;
  if (aPriority !== bPriority) return aPriority - bPriority;

  const aFreqCount = a.frequency_count ?? 0;
  const bFreqCount = b.frequency_count ?? 0;
  if (aFreqCount !== bFreqCount) return bFreqCount - aFreqCount;

  const aFrequency = a.frequency ?? 0;
  const bFrequency = b.frequency ?? 0;
  if (aFrequency !== bFrequency) return bFrequency - aFrequency;

  return getCreatedTime(a) - getCreatedTime(b);
}

function compareFrequencyGroups(a, b, direction) {
  const multiplier = direction === 'low' ? 1 : -1;
  const aFreqCount = a.maxFrequencyCount ?? 0;
  const bFreqCount = b.maxFrequencyCount ?? 0;
  if (aFreqCount !== bFreqCount) return (aFreqCount - bFreqCount) * multiplier;

  const aFrequency = a.maxFrequency ?? 0;
  const bFrequency = b.maxFrequency ?? 0;
  if (aFrequency !== bFrequency) return (aFrequency - bFrequency) * multiplier;

  const aQueue = a.bestQueuePosition ?? Number.POSITIVE_INFINITY;
  const bQueue = b.bestQueuePosition ?? Number.POSITIVE_INFINITY;
  if (aQueue !== bQueue) return aQueue - bQueue;

  if (a.nextNewEntry && b.nextNewEntry) return compareNewEntries(a.nextNewEntry, b.nextNewEntry);
  if (a.nextReviewEntry && b.nextReviewEntry) return compareReviewEntries(a.nextReviewEntry, b.nextReviewEntry);
  return a.word.localeCompare(b.word);
}

function compareDisplayEntries(a, b) {
  const aIsNew = isDictionaryEntryNew(a);
  const bIsNew = isDictionaryEntryNew(b);
  if (aIsNew && bIsNew) return compareNewEntries(a, b);
  if (aIsNew) return -1;
  if (bIsNew) return 1;
  return compareReviewEntries(a, b);
}

function buildDictionaryGroups(words, sort, dailyNewLimit) {
  const groupMap = new Map();
  for (const word of words) {
    const key = `${word.word}|${word.target_language || ''}`;
    const group = groupMap.get(key);
    if (group) group.push(word);
    else groupMap.set(key, [word]);
  }

  const groups = Array.from(groupMap.entries()).map(([key, groupEntries]) => {
    const entries = [...groupEntries].sort(compareDisplayEntries);
    const newEntries = entries.filter(isDictionaryEntryNew).sort(compareNewEntries);
    const reviewEntries = entries.filter((entry) => !isDictionaryEntryNew(entry)).sort(compareReviewEntries);
    const dueTimes = reviewEntries.map(getDueTime).filter(Number.isFinite);
    const createdTimes = entries.map(getCreatedTime);
    const maxFrequency = Math.max(...entries.map((entry) => entry.frequency ?? 0));
    const maxFrequencyCount = Math.max(...entries.map((entry) => entry.frequency_count ?? 0));
    const queuePositions = entries.map((entry) => entry.queue_position).filter(Number.isFinite);

    return {
      key,
      word: entries[0].word,
      target_language: entries[0].target_language,
      entries,
      hasNew: newEntries.length > 0,
      hasPriority: entries.some((entry) => entry.priority),
      maxFrequency: maxFrequency > 0 ? maxFrequency : null,
      maxFrequencyCount: maxFrequencyCount > 0 ? maxFrequencyCount : null,
      bestQueuePosition: queuePositions.length > 0 ? Math.min(...queuePositions) : null,
      earliestDueTime: dueTimes.length > 0 ? Math.min(...dueTimes) : Number.POSITIVE_INFINITY,
      earliestCreatedTime: Math.min(...createdTimes),
      mostRecentCreatedTime: Math.max(...createdTimes),
      nextNewEntry: newEntries[0] ?? null,
      nextReviewEntry: reviewEntries[0] ?? null,
      primaryEntry: entries[0],
    };
  });

  const todayNewKeys = new Set(
    groups
      .filter((group) => group.nextNewEntry)
      .sort((a, b) => compareNewEntries(a.nextNewEntry, b.nextNewEntry))
      .slice(0, Math.max(dailyNewLimit, 0))
      .map((group) => group.key),
  );

  if (sort === 'queue') {
    groups.sort((a, b) => {
      if (a.nextNewEntry && b.nextNewEntry) {
        return compareNewEntries(a.nextNewEntry, b.nextNewEntry);
      }
      if (a.nextNewEntry) return -1;
      if (b.nextNewEntry) return 1;
      if (a.nextReviewEntry && b.nextReviewEntry) {
        return compareReviewEntries(a.nextReviewEntry, b.nextReviewEntry);
      }
      if (a.nextReviewEntry) return -1;
      if (b.nextReviewEntry) return 1;
      return a.word.localeCompare(b.word);
    });
  } else if (sort === 'az') {
    groups.sort((a, b) => a.word.localeCompare(b.word));
  } else if (sort === 'freq-high') {
    groups.sort((a, b) => compareFrequencyGroups(a, b, 'high'));
  } else if (sort === 'freq-low') {
    groups.sort((a, b) => compareFrequencyGroups(a, b, 'low'));
  } else if (sort === 'due') {
    groups.sort((a, b) => {
      if (a.nextReviewEntry && b.nextReviewEntry) return compareReviewEntries(a.nextReviewEntry, b.nextReviewEntry);
      if (a.nextReviewEntry) return -1;
      if (b.nextReviewEntry) return 1;
      if (a.nextNewEntry && b.nextNewEntry) return compareNewEntries(a.nextNewEntry, b.nextNewEntry);
      if (a.nextNewEntry) return -1;
      if (b.nextNewEntry) return 1;
      return a.word.localeCompare(b.word);
    });
  } else {
    groups.sort((a, b) => b.mostRecentCreatedTime - a.mostRecentCreatedTime);
  }

  for (const group of groups) {
    if (sort === 'queue' && todayNewKeys.has(group.key) && group.nextNewEntry) {
      group.primaryEntry = group.nextNewEntry;
    } else if (sort === 'queue' && group.nextReviewEntry) {
      group.primaryEntry = group.nextReviewEntry;
    } else if (group.nextNewEntry) {
      group.primaryEntry = group.nextNewEntry;
    }
    delete group.nextNewEntry;
    delete group.nextReviewEntry;
  }

  return {
    groups,
    dueNextGroupKeys: Array.from(todayNewKeys),
  };
}

export async function listDictionaryGroupPage(db, userId, { page = 0, limit = 20, search = '', sort = 'queue', timeZone = 'UTC' } = {}) {
  await ensureCardsScheduled(db, userId, timeZone);
  const { rows: prefsRows } = await db.query(
    'SELECT target_language, daily_new_limit FROM users WHERE id = $1',
    [userId],
  );
  const prefs = prefsRows[0] ?? { target_language: null, daily_new_limit: 0 };
  const targetLanguage = prefs.target_language ?? null;
  const dailyNewLimit = prefs.daily_new_limit ?? 0;
  // Fold case and diacritics so "dano" matches "daño". NFD splits accented
  // letters into base + combining mark; stripping the marks leaves the base.
  const trimmedSearch = search
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const key = _cacheKey(userId, targetLanguage, trimmedSearch, sort, timeZone);
  const cached = _groupCache.get(key);

  let groups, dueNextGroupKeys;

  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    ({ groups, dueNextGroupKeys } = cached);
  } else {
    const params = [userId, targetLanguage];
    let whereClause = `
      user_id = $1
      AND target_language IS NOT DISTINCT FROM $2
    `;

    if (trimmedSearch) {
      params.push(`%${trimmedSearch}%`);
      // Strip the same diacritics on the SQL side that the JS fold above
      // strips from the query, so "dano" matches "daño".
      const fold = (col) =>
        `translate(LOWER(${col}), 'áàâãäåéèêëíìîïóòôõöúùûüñçýÿ', 'aaaaaaeeeeiiiiooooouuuuncyy')`;
      whereClause += ` AND (
        ${fold('word')} LIKE $${params.length}
        OR ${fold('translation')} LIKE $${params.length}
      )`;
    }

    const [{ rows }, { rows: introRows }] = await Promise.all([
      db.query(
        `SELECT * FROM saved_words
         WHERE ${whereClause}`,
        params,
      ),
      db.query(
        `SELECT COUNT(*)::int AS cnt FROM saved_words
         WHERE user_id = $1
           AND target_language IS NOT DISTINCT FROM $2
           AND introduced_date = (NOW() AT TIME ZONE $3)::date`,
        [userId, targetLanguage, timeZone],
      ),
    ]);

    const introducedToday = introRows[0]?.cnt ?? 0;
    const adjustedNewLimit = Math.max(0, dailyNewLimit - introducedToday);

    const projectedRows = withProjectedNewDueDates(rows, dailyNewLimit, introducedToday, timeZone);
    ({ groups, dueNextGroupKeys } = buildDictionaryGroups(projectedRows, sort, adjustedNewLimit));
    _groupCache.set(key, { groups, dueNextGroupKeys, ts: Date.now() });
  }

  const safeLimit = Math.max(1, limit);
  const totalGroups = groups.length;
  const totalPages = Math.max(1, Math.ceil(totalGroups / safeLimit));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const pageGroups = groups.slice(safePage * safeLimit, (safePage + 1) * safeLimit);

  return {
    groups: pageGroups,
    dueNextGroupKeys,
    page: safePage,
    totalGroups,
    totalPages,
  };
}

export async function listCalendarCounts(db, userId, year, month, timeZone = 'UTC') {
  await ensureCardsScheduled(db, userId, timeZone);
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
  await ensureCardsScheduled(db, userId, timeZone);
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
