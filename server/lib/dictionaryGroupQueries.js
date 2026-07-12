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

export function interleaveStudyQueueRows(rows) {
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

function invalidCursor(message) {
  const error = new Error(message);
  error.status = 400;
  error.expose = true;
  return error;
}

function encodeDictionaryCursor(payload) {
  return Buffer.from(JSON.stringify({ version: 1, ...payload })).toString('base64url');
}

function decodeDictionaryCursor(cursor, context) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value.version !== 1 || value.sort !== context.sort || value.search !== context.search || value.targetLanguage !== context.targetLanguage) {
      throw new Error('cursor context changed');
    }
    if (!Number.isInteger(value.page) || value.page < 0 || !Number.isInteger(value.totalGroups) || value.totalGroups < 0 || !Array.isArray(value.values)) {
      throw new Error('cursor fields are invalid');
    }
    return value;
  } catch (error) {
    throw invalidCursor(`Invalid dictionary cursor: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function dictionaryCursorPlan(sort, cursor, startParameter = 5) {
  const p = (offset, type) => `$${startParameter + offset}::${type}`;
  const plans = {
    queue: {
      select: `CASE WHEN has_new THEN 0 ELSE 1 END AS cursor_a,
               COALESCE(new_queue, 2147483647) AS cursor_b,
               COALESCE(review_due, 'infinity'::timestamptz)::text AS cursor_c`,
      values: (row) => [Number(row.cursor_a), String(row.cursor_b), row.cursor_c, row.word],
      predicate: `(CASE WHEN has_new THEN 0 ELSE 1 END > ${p(0, 'int')}
        OR (CASE WHEN has_new THEN 0 ELSE 1 END = ${p(0, 'int')} AND COALESCE(new_queue, 2147483647) > ${p(1, 'bigint')})
        OR (CASE WHEN has_new THEN 0 ELSE 1 END = ${p(0, 'int')} AND COALESCE(new_queue, 2147483647) = ${p(1, 'bigint')} AND COALESCE(review_due, 'infinity'::timestamptz) > ${p(2, 'timestamptz')})
        OR (CASE WHEN has_new THEN 0 ELSE 1 END = ${p(0, 'int')} AND COALESCE(new_queue, 2147483647) = ${p(1, 'bigint')} AND COALESCE(review_due, 'infinity'::timestamptz) = ${p(2, 'timestamptz')} AND word > ${p(3, 'text')}))`,
    },
    az: {
      select: `word AS cursor_a`,
      values: (row) => [row.word],
      predicate: `word > ${p(0, 'text')}`,
    },
    'freq-high': {
      select: `COALESCE(max_frequency_count, -1) AS cursor_a,
               COALESCE(max_frequency, -1) AS cursor_b,
               COALESCE(new_queue, 2147483647) AS cursor_c`,
      values: (row) => [String(row.cursor_a), Number(row.cursor_b), String(row.cursor_c), row.word],
      predicate: `(COALESCE(max_frequency_count, -1) < ${p(0, 'bigint')}
        OR (COALESCE(max_frequency_count, -1) = ${p(0, 'bigint')} AND COALESCE(max_frequency, -1) < ${p(1, 'numeric')})
        OR (COALESCE(max_frequency_count, -1) = ${p(0, 'bigint')} AND COALESCE(max_frequency, -1) = ${p(1, 'numeric')} AND COALESCE(new_queue, 2147483647) > ${p(2, 'bigint')})
        OR (COALESCE(max_frequency_count, -1) = ${p(0, 'bigint')} AND COALESCE(max_frequency, -1) = ${p(1, 'numeric')} AND COALESCE(new_queue, 2147483647) = ${p(2, 'bigint')} AND word > ${p(3, 'text')}))`,
    },
    'freq-low': {
      select: `COALESCE(max_frequency_count, 9223372036854775807) AS cursor_a,
               COALESCE(max_frequency, 2147483647) AS cursor_b,
               COALESCE(new_queue, 2147483647) AS cursor_c`,
      values: (row) => [String(row.cursor_a), Number(row.cursor_b), String(row.cursor_c), row.word],
      predicate: `(COALESCE(max_frequency_count, 9223372036854775807) > ${p(0, 'bigint')}
        OR (COALESCE(max_frequency_count, 9223372036854775807) = ${p(0, 'bigint')} AND COALESCE(max_frequency, 2147483647) > ${p(1, 'numeric')})
        OR (COALESCE(max_frequency_count, 9223372036854775807) = ${p(0, 'bigint')} AND COALESCE(max_frequency, 2147483647) = ${p(1, 'numeric')} AND COALESCE(new_queue, 2147483647) > ${p(2, 'bigint')})
        OR (COALESCE(max_frequency_count, 9223372036854775807) = ${p(0, 'bigint')} AND COALESCE(max_frequency, 2147483647) = ${p(1, 'numeric')} AND COALESCE(new_queue, 2147483647) = ${p(2, 'bigint')} AND word > ${p(3, 'text')}))`,
    },
    due: {
      select: `COALESCE(review_due, 'infinity'::timestamptz)::text AS cursor_a,
               CASE WHEN has_new THEN 0 ELSE 1 END AS cursor_b,
               COALESCE(new_queue, 2147483647) AS cursor_c`,
      values: (row) => [row.cursor_a, Number(row.cursor_b), String(row.cursor_c), row.word],
      predicate: `(COALESCE(review_due, 'infinity'::timestamptz) > ${p(0, 'timestamptz')}
        OR (COALESCE(review_due, 'infinity'::timestamptz) = ${p(0, 'timestamptz')} AND CASE WHEN has_new THEN 0 ELSE 1 END > ${p(1, 'int')})
        OR (COALESCE(review_due, 'infinity'::timestamptz) = ${p(0, 'timestamptz')} AND CASE WHEN has_new THEN 0 ELSE 1 END = ${p(1, 'int')} AND COALESCE(new_queue, 2147483647) > ${p(2, 'bigint')})
        OR (COALESCE(review_due, 'infinity'::timestamptz) = ${p(0, 'timestamptz')} AND CASE WHEN has_new THEN 0 ELSE 1 END = ${p(1, 'int')} AND COALESCE(new_queue, 2147483647) = ${p(2, 'bigint')} AND word > ${p(3, 'text')}))`,
    },
    date: {
      select: `latest_created::text AS cursor_a`,
      values: (row) => [row.cursor_a, row.word],
      predicate: `(latest_created < ${p(0, 'timestamptz')} OR (latest_created = ${p(0, 'timestamptz')} AND word > ${p(1, 'text')}))`,
    },
  };
  const plan = plans[sort] || plans.date;
  return { ...plan, cursorValues: cursor ? cursor.values : [] };
}

export async function listDictionaryGroupPage(db, userId, { page = 0, cursor = null, limit = 20, search = '', sort = 'queue', timeZone = 'UTC' } = {}) {
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

  const safeLimit = Math.max(1, limit);
  const fold = (column) =>
    `translate(LOWER(${column}), 'áàâãäåéèêëíìîïóòôõöúùûüñçýÿ', 'aaaaaaeeeeiiiiooooouuuuncyy')`;
  const summaryCte = `
    WITH filtered AS (
      SELECT sw.*
      FROM saved_words sw
      WHERE sw.user_id = $1
        AND sw.target_language IS NOT DISTINCT FROM $2
        AND ($3::text = '' OR ${fold('sw.word')} LIKE '%' || $3 || '%' OR ${fold('sw.translation')} LIKE '%' || $3 || '%')
    ), summaries AS (
      SELECT
        word,
        target_language,
        BOOL_OR(srs_interval = 0 AND learning_step IS NULL AND last_reviewed_at IS NULL) AS has_new,
        MIN(queue_position) FILTER (WHERE srs_interval = 0 AND learning_step IS NULL AND last_reviewed_at IS NULL) AS new_queue,
        MIN(due_at) FILTER (WHERE NOT (srs_interval = 0 AND learning_step IS NULL AND last_reviewed_at IS NULL)) AS review_due,
        MAX(frequency_count) AS max_frequency_count,
        MAX(frequency) AS max_frequency,
        MIN(created_at) AS earliest_created,
        MAX(created_at) AS latest_created
      FROM filtered
      GROUP BY word, target_language
    )`;
  const orderBy = {
    queue: 'has_new DESC, new_queue ASC NULLS LAST, review_due ASC NULLS LAST, word ASC',
    az: 'word ASC',
    'freq-high': 'max_frequency_count DESC NULLS LAST, max_frequency DESC NULLS LAST, new_queue ASC NULLS LAST, word ASC',
    'freq-low': 'max_frequency_count ASC NULLS LAST, max_frequency ASC NULLS LAST, new_queue ASC NULLS LAST, word ASC',
    due: 'review_due ASC NULLS LAST, has_new DESC, new_queue ASC NULLS LAST, word ASC',
    date: 'latest_created DESC, word ASC',
  }[sort] || 'latest_created DESC, word ASC';
  const baseParams = [userId, targetLanguage, trimmedSearch];
  const decodedCursor = decodeDictionaryCursor(cursor, { sort, search: trimmedSearch, targetLanguage });
  const cursorPlan = dictionaryCursorPlan(sort, decodedCursor);
  const [{ rows: countRows }, { rows: introRows }] = await Promise.all([
    decodedCursor
      ? Promise.resolve({ rows: [{ count: decodedCursor.totalGroups }] })
      : db.query(`${summaryCte} SELECT COUNT(*)::int AS count FROM summaries`, baseParams),
    db.query(
      `SELECT COUNT(*)::int AS cnt FROM saved_words
       WHERE user_id = $1
         AND target_language IS NOT DISTINCT FROM $2
         AND introduced_date = (NOW() AT TIME ZONE $3)::date`,
      [userId, targetLanguage, timeZone],
    ),
  ]);
  const totalGroups = countRows[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalGroups / safeLimit));
  const safePage = decodedCursor ? decodedCursor.page + 1 : 0;
  const introducedToday = introRows[0]?.cnt ?? 0;
  const adjustedNewLimit = Math.max(0, dailyNewLimit - introducedToday);

  const [{ rows: fetchedPageKeys }, { rows: dueKeyRows }] = await Promise.all([
    db.query(
      `${summaryCte}
       SELECT word, target_language, ${cursorPlan.select} FROM summaries
       ${decodedCursor ? `WHERE ${cursorPlan.predicate}` : ''}
       ORDER BY ${orderBy}
       LIMIT $4`,
      [...baseParams, safeLimit + 1, ...cursorPlan.cursorValues],
    ),
    adjustedNewLimit > 0
      ? db.query(
        `${summaryCte}
         SELECT word, target_language FROM summaries
         WHERE has_new
         ORDER BY new_queue ASC NULLS LAST, word ASC
         LIMIT $4`,
        [...baseParams, adjustedNewLimit],
      )
      : Promise.resolve({ rows: [] }),
  ]);
  const hasMore = fetchedPageKeys.length > safeLimit;
  const pageKeys = fetchedPageKeys.slice(0, safeLimit);

  let pageGroups = [];
  if (pageKeys.length > 0) {
    const { rows } = await db.query(
      `SELECT sw.*
       FROM saved_words sw
       JOIN jsonb_to_recordset($3::jsonb) AS key(word text, target_language text)
         ON sw.word = key.word
        AND sw.target_language IS NOT DISTINCT FROM key.target_language
       WHERE sw.user_id = $1
         AND sw.target_language IS NOT DISTINCT FROM $2`,
      [userId, targetLanguage, JSON.stringify(pageKeys)],
    );
    const projectedRows = withProjectedNewDueDates(rows, dailyNewLimit, introducedToday, timeZone);
    const built = buildDictionaryGroups(projectedRows, sort, adjustedNewLimit).groups;
    const groupByKey = new Map(built.map((group) => [group.key, group]));
    pageGroups = pageKeys
      .map((key) => groupByKey.get(`${key.word}|${key.target_language || ''}`))
      .filter(Boolean);
  }

  const dueNextGroupKeys = dueKeyRows.map((key) => `${key.word}|${key.target_language || ''}`);
  const lastKey = pageKeys.at(-1);
  const nextCursor = hasMore && lastKey
    ? encodeDictionaryCursor({
      sort,
      search: trimmedSearch,
      targetLanguage,
      page: safePage,
      totalGroups,
      values: cursorPlan.values(lastKey),
    })
    : null;

  return {
    groups: pageGroups,
    dueNextGroupKeys,
    page: safePage,
    totalGroups,
    totalPages,
    nextCursor,
    hasMore,
  };
}
