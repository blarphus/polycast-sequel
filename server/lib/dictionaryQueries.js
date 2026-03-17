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
     ),
     introduced_today AS (
       SELECT COUNT(*)::int AS cnt
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.introduced_date = CURRENT_DATE
     )
     SELECT sw.*
     FROM saved_words sw
     CROSS JOIN prefs p
     WHERE sw.user_id = $1
       AND sw.target_language IS NOT DISTINCT FROM p.target_language
       AND sw.due_at IS NULL
       AND sw.last_reviewed_at IS NULL
     ORDER BY ${NEW_TODAY_ORDER_BY}
     LIMIT GREATEST(COALESCE((SELECT daily_new_limit FROM prefs), 0) - (SELECT cnt FROM introduced_today), 0)`,
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
     introduced_today AS (
       SELECT COUNT(*)::int AS cnt
       FROM saved_words sw
       CROSS JOIN prefs p
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM p.target_language
         AND sw.introduced_date = CURRENT_DATE
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
       LIMIT GREATEST(COALESCE((SELECT daily_new_limit FROM prefs), 0) - (SELECT cnt FROM introduced_today), 0)
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

function isDictionaryEntryNew(word) {
  return word.srs_interval === 0 && word.learning_step === null && !word.last_reviewed_at;
}

function getCreatedTime(word) {
  return new Date(word.created_at).getTime();
}

function getDueTime(word) {
  if (!word.due_at) return Number.POSITIVE_INFINITY;
  const time = new Date(word.due_at).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function compareNewEntries(a, b) {
  const aPriority = a.priority ? 0 : 1;
  const bPriority = b.priority ? 0 : 1;
  if (aPriority !== bPriority) return aPriority - bPriority;

  const aFrequency = a.frequency ?? 0;
  const bFrequency = b.frequency ?? 0;
  if (aFrequency !== bFrequency) return bFrequency - aFrequency;

  const createdDiff = getCreatedTime(a) - getCreatedTime(b);
  if (createdDiff !== 0) return createdDiff;

  const aQueue = a.queue_position ?? Number.POSITIVE_INFINITY;
  const bQueue = b.queue_position ?? Number.POSITIVE_INFINITY;
  return aQueue - bQueue;
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

  const aFrequency = a.frequency ?? 0;
  const bFrequency = b.frequency ?? 0;
  if (aFrequency !== bFrequency) return bFrequency - aFrequency;

  return getCreatedTime(a) - getCreatedTime(b);
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

    return {
      key,
      word: entries[0].word,
      target_language: entries[0].target_language,
      entries,
      hasNew: newEntries.length > 0,
      hasPriority: entries.some((entry) => entry.priority),
      maxFrequency: maxFrequency > 0 ? maxFrequency : null,
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
      .slice(0, Math.max(0, dailyNewLimit))
      .map((group) => group.key),
  );

  if (sort === 'queue') {
    groups.sort((a, b) => {
      const aTodayNew = todayNewKeys.has(a.key) ? 0 : 1;
      const bTodayNew = todayNewKeys.has(b.key) ? 0 : 1;
      if (aTodayNew !== bTodayNew) return aTodayNew - bTodayNew;
      if (aTodayNew === 0 && a.nextNewEntry && b.nextNewEntry) {
        return compareNewEntries(a.nextNewEntry, b.nextNewEntry);
      }

      const aHasReview = a.nextReviewEntry ? 0 : 1;
      const bHasReview = b.nextReviewEntry ? 0 : 1;
      if (aHasReview !== bHasReview) return aHasReview - bHasReview;
      if (a.nextReviewEntry && b.nextReviewEntry) {
        return compareReviewEntries(a.nextReviewEntry, b.nextReviewEntry);
      }
      if (a.nextNewEntry && b.nextNewEntry) {
        return compareNewEntries(a.nextNewEntry, b.nextNewEntry);
      }
      return a.word.localeCompare(b.word);
    });
  } else if (sort === 'az') {
    groups.sort((a, b) => a.word.localeCompare(b.word));
  } else if (sort === 'freq-high') {
    groups.sort((a, b) => (b.maxFrequency ?? 0) - (a.maxFrequency ?? 0));
  } else if (sort === 'freq-low') {
    groups.sort((a, b) => (a.maxFrequency ?? 0) - (b.maxFrequency ?? 0));
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

export async function listDictionaryGroupPage(db, userId, { page = 0, limit = 20, search = '', sort = 'queue' } = {}) {
  const { rows: prefsRows } = await db.query(
    'SELECT target_language, daily_new_limit FROM users WHERE id = $1',
    [userId],
  );
  const prefs = prefsRows[0] ?? { target_language: null, daily_new_limit: 0 };
  const targetLanguage = prefs.target_language ?? null;
  const dailyNewLimit = prefs.daily_new_limit ?? 0;
  const trimmedSearch = search.trim().toLowerCase();

  const params = [userId, targetLanguage];
  let whereClause = `
    user_id = $1
    AND target_language IS NOT DISTINCT FROM $2
  `;

  if (trimmedSearch) {
    params.push(`%${trimmedSearch}%`);
    whereClause += ` AND (
      LOWER(word) LIKE $${params.length}
      OR LOWER(translation) LIKE $${params.length}
    )`;
  }

  const { rows } = await db.query(
    `SELECT * FROM saved_words
     WHERE ${whereClause}`,
    params,
  );

  const { rows: introRows } = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM saved_words
     WHERE user_id = $1
       AND target_language IS NOT DISTINCT FROM $2
       AND introduced_date = CURRENT_DATE`,
    [userId, targetLanguage],
  );
  const introducedToday = introRows[0]?.cnt ?? 0;
  const adjustedNewLimit = Math.max(0, dailyNewLimit - introducedToday);

  const { groups, dueNextGroupKeys } = buildDictionaryGroups(rows, sort, adjustedNewLimit);
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

export async function listCalendarCounts(db, userId, year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  // First day of next month
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const { rows: prefsRows } = await db.query(
    'SELECT target_language, daily_new_limit FROM users WHERE id = $1',
    [userId],
  );
  const targetLanguage = prefsRows[0]?.target_language ?? null;

  const { rows: dayCounts } = await db.query(
    `SELECT due_at::date AS date, COUNT(*)::int AS count
     FROM saved_words
     WHERE user_id = $1
       AND target_language IS NOT DISTINCT FROM $2
       AND due_at IS NOT NULL
       AND due_at::date >= $3::date
       AND due_at::date < $4::date
     GROUP BY due_at::date
     ORDER BY due_at::date`,
    [userId, targetLanguage, startDate, endDate],
  );

  const { rows: newRows } = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM saved_words
     WHERE user_id = $1
       AND target_language IS NOT DISTINCT FROM $2
       AND due_at IS NULL
       AND last_reviewed_at IS NULL`,
    [userId, targetLanguage],
  );

  return {
    days: dayCounts.map((r) => ({ date: r.date, count: r.count })),
    newToday: newRows[0]?.count ?? 0,
  };
}

export async function listCalendarDayWords(db, userId, date) {
  const { rows: prefsRows } = await db.query(
    'SELECT target_language FROM users WHERE id = $1',
    [userId],
  );
  const targetLanguage = prefsRows[0]?.target_language ?? null;

  const { rows } = await db.query(
    `SELECT * FROM saved_words
     WHERE user_id = $1
       AND target_language IS NOT DISTINCT FROM $2
       AND due_at::date = $3::date
     ORDER BY due_at ASC`,
    [userId, targetLanguage, date],
  );
  return rows;
}
