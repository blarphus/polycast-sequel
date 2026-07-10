import crypto from 'crypto';

export const WORD_SAVE_XP = 10;
export const WILD_RECALL_XP = 15;
export const WILD_RECALL_DAILY_CAP = 3;
export const SESSION_COMPLETION_XP = 25;
export const SESSION_DAILY_CAP = 2;
export const DAILY_ACTIVITY_XP_TARGET = 50;
export const XP_PER_LEVEL = 250;

export function localDate(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function canonicalWord(word) {
  return String(word.lemma || word.word || '').trim().toLocaleLowerCase();
}

async function lockedProgress(client, userId, date) {
  await client.query(
    `INSERT INTO daily_learning_progress (user_id, local_date)
     VALUES ($1, $2) ON CONFLICT (user_id, local_date) DO NOTHING`,
    [userId, date],
  );
  const { rows } = await client.query(
    `SELECT * FROM daily_learning_progress WHERE user_id = $1 AND local_date = $2 FOR UPDATE`,
    [userId, date],
  );
  return rows[0];
}

export async function progressionSnapshot(db, userId, timeZone) {
  const date = localDate(timeZone);
  const start = new Date(`${date}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const startDate = start.toISOString().slice(0, 10);
  const [{ rows: users }, { rows: progressRows }, { rows: xpRows }, { rows: weekRows }] = await Promise.all([
    db.query('SELECT daily_word_goal, total_xp, progression_accent FROM users WHERE id = $1', [userId]),
    db.query('SELECT word_adds, wild_recall_answered, rewarded_sessions FROM daily_learning_progress WHERE user_id = $1 AND local_date = $2', [userId, date]),
    db.query('SELECT COALESCE(SUM(amount), 0)::int AS xp FROM xp_events WHERE user_id = $1 AND local_date = $2', [userId, date]),
    db.query(
      `SELECT local_date::text AS local_date, COALESCE(SUM(amount), 0)::int AS xp
         FROM xp_events
        WHERE user_id = $1 AND local_date BETWEEN $2 AND $3
        GROUP BY local_date ORDER BY local_date`,
      [userId, startDate, date],
    ),
  ]);
  const user = users[0] || { daily_word_goal: 5, total_xp: 0, progression_accent: 'indigo' };
  const progress = progressRows[0] || { word_adds: 0, wild_recall_answered: 0, rewarded_sessions: 0 };
  const goal = Math.max(1, Number(user.daily_word_goal) || 5);
  const added = Math.max(0, Number(progress.word_adds) || 0);
  const recalled = Math.max(0, Number(progress.wild_recall_answered) || 0);
  const rewardedSessions = Math.max(0, Number(progress.rewarded_sessions) || 0);
  const todayXp = Math.max(0, Number(xpRows[0]?.xp) || 0);
  const totalXp = Math.max(0, Number(user.total_xp) || 0);
  const level = Math.floor(totalXp / XP_PER_LEVEL) + 1;
  const weekByDate = new Map(weekRows.map((row) => [row.local_date, Number(row.xp) || 0]));
  const week = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(`${date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - offset);
    const dayKey = day.toISOString().slice(0, 10);
    const xp = weekByDate.get(dayKey) || 0;
    week.push({ date: dayKey, xp, complete: xp >= DAILY_ACTIVITY_XP_TARGET });
  }
  const unlockedAccents = ['indigo'];
  if (level >= 3) unlockedAccents.push('teal');
  if (level >= 6) unlockedAccents.push('coral');
  if (level >= 10) unlockedAccents.push('gold');
  const selectedAccent = unlockedAccents.includes(user.progression_accent) ? user.progression_accent : 'indigo';
  return {
    totalXp,
    dailyActivity: {
      targetXp: DAILY_ACTIVITY_XP_TARGET,
      earnedXp: todayXp,
      remainingXp: Math.max(0, DAILY_ACTIVITY_XP_TARGET - todayXp),
      complete: todayXp >= DAILY_ACTIVITY_XP_TARGET,
    },
    dailyGoal: {
      goal,
      added,
      remaining: Math.max(0, goal - added),
      complete: added >= goal,
      wordSaveXpRemaining: Math.max(0, goal - added),
    },
    wildRecall: { answered: recalled, remaining: Math.max(0, WILD_RECALL_DAILY_CAP - recalled) },
    sessionRewards: { awarded: rewardedSessions, remaining: Math.max(0, SESSION_DAILY_CAP - rewardedSessions) },
    week,
    level: {
      number: level,
      currentXp: totalXp % XP_PER_LEVEL,
      nextXp: XP_PER_LEVEL,
      selectedAccent,
      unlockedAccents,
    },
  };
}

export async function awardLearningSessionXp(client, userId, sessionId, timeZone) {
  const date = localDate(timeZone);
  const progress = await lockedProgress(client, userId, date);
  const dedupeKey = `session-complete:${sessionId}`;
  const existing = await client.query('SELECT amount FROM xp_events WHERE dedupe_key = $1', [dedupeKey]);
  if (existing.rowCount) return Number(existing.rows[0].amount) || 0;

  const amount = progress.rewarded_sessions < SESSION_DAILY_CAP ? SESSION_COMPLETION_XP : 0;
  await client.query(
    `INSERT INTO xp_events (user_id, source, amount, local_date, dedupe_key, learning_session_id)
     VALUES ($1, 'session_complete', $2, $3, $4, $5)`,
    [userId, amount, date, dedupeKey, sessionId],
  );
  if (amount) {
    await client.query(
      `UPDATE daily_learning_progress SET rewarded_sessions = rewarded_sessions + 1
        WHERE user_id = $1 AND local_date = $2`,
      [userId, date],
    );
    await client.query('UPDATE users SET total_xp = total_xp + $2 WHERE id = $1', [userId, amount]);
  }
  return amount;
}

export async function awardWordSaveXp(pool, userId, savedWord, timeZone) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const date = localDate(timeZone);
    const { rows: users } = await client.query(
      'SELECT daily_word_goal FROM users WHERE id = $1 FOR UPDATE', [userId],
    );
    const goal = Math.max(1, Number(users[0]?.daily_word_goal) || 5);
    let progress = await lockedProgress(client, userId, date);
    const key = `word-add:${userId}:${date}:${savedWord.target_language || ''}:${canonicalWord(savedWord)}`;
    const inserted = await client.query(
      `INSERT INTO xp_events (user_id, source, amount, saved_word_id, local_date, dedupe_key)
       VALUES ($1, 'word_add', 0, $2, $3, $4)
       ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [userId, savedWord.id, date, key],
    );
    let awardedXp = 0;
    if (inserted.rowCount) {
      const nextAdded = progress.word_adds + 1;
      awardedXp = progress.word_adds < goal ? WORD_SAVE_XP : 0;
      await client.query(
        `UPDATE daily_learning_progress SET word_adds = $3
         WHERE user_id = $1 AND local_date = $2`, [userId, date, nextAdded],
      );
      if (awardedXp) {
        await client.query('UPDATE xp_events SET amount = $2 WHERE id = $1', [inserted.rows[0].id, awardedXp]);
        await client.query('UPDATE users SET total_xp = total_xp + $2 WHERE id = $1', [userId, awardedXp]);
      }
      progress = { ...progress, word_adds: nextAdded };
    }
    await client.query('COMMIT');
    return { awardedXp, progression: await progressionSnapshot(pool, userId, timeZone) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function pendingWildRecall(db, userId) {
  const { rows } = await db.query(
    `SELECT c.id, c.saved_word_id, c.options, c.status, c.retry_on,
            w.word, w.lemma, w.forms, w.translation
       FROM wild_recall_challenges c
       JOIN saved_words w ON w.id = c.saved_word_id
      WHERE c.user_id = $1 AND c.status = 'pending'
      ORDER BY c.created_at DESC LIMIT 1`, [userId],
  );
  return rows[0] || null;
}

function publicChallenge(row) {
  if (!row) return null;
  return {
    id: row.id,
    savedWordId: row.saved_word_id,
    word: row.word,
    lemma: row.lemma,
    forms: row.forms,
    options: Array.isArray(row.options) ? row.options : [],
  };
}

export async function armWildRecall(pool, userId, wordId, timeZone) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await pendingWildRecall(client, userId);
    if (existing) {
      await client.query('COMMIT');
      return { challenge: publicChallenge(existing), progression: await progressionSnapshot(pool, userId, timeZone) };
    }
    const date = localDate(timeZone);
    const progress = await lockedProgress(client, userId, date);
    if (progress.wild_recall_answered >= WILD_RECALL_DAILY_CAP) {
      await client.query('COMMIT');
      return { challenge: null, progression: await progressionSnapshot(pool, userId, timeZone), capped: true };
    }
    const { rows: candidates } = await client.query(
      `SELECT * FROM saved_words
        WHERE id = $1 AND user_id = $2 AND last_reviewed_at IS NOT NULL`, [wordId, userId],
    );
    const word = candidates[0];
    const { rows: retryRows } = word ? await client.query(
      `SELECT retry_on FROM wild_recall_challenges
        WHERE user_id = $1 AND saved_word_id = $2 AND correct = false
        ORDER BY answered_at DESC NULLS LAST LIMIT 1`,
      [userId, word.id],
    ) : { rows: [] };
    if (!word || (retryRows[0]?.retry_on && retryRows[0].retry_on > date)) {
      await client.query('COMMIT');
      return { challenge: null, progression: await progressionSnapshot(pool, userId, timeZone) };
    }
    const { rows: distractors } = await client.query(
      `SELECT id, translation FROM saved_words
        WHERE user_id = $1 AND id <> $2
          AND target_language IS NOT DISTINCT FROM $3
          AND translation <> '' AND translation <> $4
        GROUP BY id, translation
        ORDER BY random() LIMIT 12`,
      [userId, word.id, word.target_language, word.translation],
    );
    const unique = [];
    const seen = new Set([String(word.translation).trim().toLocaleLowerCase()]);
    for (const row of distractors) {
      const key = String(row.translation).trim().toLocaleLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
      if (unique.length === 3) break;
    }
    if (unique.length < 3 || !String(word.translation).trim()) {
      await client.query('COMMIT');
      return { challenge: null, progression: await progressionSnapshot(pool, userId, timeZone), unavailable: 'Need four distinct saved meanings.' };
    }
    const correctOptionId = crypto.randomUUID();
    const options = [
      { id: correctOptionId, text: word.translation },
      ...unique.map((row) => ({ id: crypto.randomUUID(), text: row.translation })),
    ].sort(() => Math.random() - 0.5);
    const { rows: created } = await client.query(
      `INSERT INTO wild_recall_challenges (user_id, saved_word_id, options, correct_option_id)
       VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
      [userId, word.id, JSON.stringify(options), correctOptionId],
    );
    await client.query('COMMIT');
    return {
      challenge: publicChallenge({ ...word, id: created[0].id, saved_word_id: word.id, options }),
      progression: await progressionSnapshot(pool, userId, timeZone),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function answerWildRecall(pool, userId, challengeId, optionId, timeZone) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const date = localDate(timeZone);
    await lockedProgress(client, userId, date);
    const { rows } = await client.query(
      `SELECT * FROM wild_recall_challenges
        WHERE id = $1 AND user_id = $2 AND status = 'pending' AND clicked_at IS NOT NULL FOR UPDATE`, [challengeId, userId],
    );
    const challenge = rows[0];
    if (!challenge) throw new Error('Recall challenge is no longer available');
    const correct = optionId === challenge.correct_option_id;
    const correctAnswer = (Array.isArray(challenge.options) ? challenge.options : [])
      .find((option) => option.id === challenge.correct_option_id)?.text || '';
    const nextRetry = correct ? null : localDate(timeZone, new Date(Date.now() + 86_400_000));
    await client.query(
      `UPDATE wild_recall_challenges
          SET status = 'answered', answered_at = NOW(), correct = $2, retry_on = $3
        WHERE id = $1`, [challengeId, correct, nextRetry],
    );
    let awardedXp = 0;
    if (correct) {
      awardedXp = WILD_RECALL_XP;
      await client.query(
        `INSERT INTO xp_events (user_id, source, amount, saved_word_id, local_date, dedupe_key)
         VALUES ($1, 'wild_recall', $2, $3, $4, $5)`,
        [userId, awardedXp, challenge.saved_word_id, date, `wild-recall:${challengeId}`],
      );
      await client.query('UPDATE users SET total_xp = total_xp + $2 WHERE id = $1', [userId, awardedXp]);
    }
    await client.query('COMMIT');
    return { correct, correctAnswer, awardedXp, progression: await progressionSnapshot(pool, userId, timeZone) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function clickWildRecall(pool, userId, challengeId, timeZone) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const date = localDate(timeZone);
    const progress = await lockedProgress(client, userId, date);
    const { rows } = await client.query(
      `SELECT * FROM wild_recall_challenges
        WHERE id = $1 AND user_id = $2 AND status = 'pending' FOR UPDATE`,
      [challengeId, userId],
    );
    const challenge = rows[0];
    if (!challenge) throw new Error('Recall challenge is no longer available');
    if (!challenge.clicked_at && progress.wild_recall_answered >= WILD_RECALL_DAILY_CAP) {
      await client.query('COMMIT');
      return { capped: true, progression: await progressionSnapshot(pool, userId, timeZone) };
    }
    if (!challenge.clicked_at) {
      await client.query('UPDATE wild_recall_challenges SET clicked_at = NOW() WHERE id = $1', [challengeId]);
      await client.query(
        `UPDATE daily_learning_progress SET wild_recall_answered = wild_recall_answered + 1
          WHERE user_id = $1 AND local_date = $2`,
        [userId, date],
      );
    }
    await client.query('COMMIT');
    return { capped: false, progression: await progressionSnapshot(pool, userId, timeZone) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
