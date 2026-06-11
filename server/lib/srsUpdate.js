import { computeNextReview } from './srsAlgorithm.js';

/**
 * Apply an SRS review to a saved word.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db - Pool or client
 * @param {string} wordId - saved_words.id
 * @param {string} userId - owner user ID
 * @param {'again'|'hard'|'good'|'easy'} answer
 * @param {string} timeZone - user's IANA timezone for calendar-day intervals
 * @returns {Promise<object|null>} Updated row, or null if not found
 */
export function validTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length > 100) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export async function applySrsReview(db, wordId, userId, answer, timeZone = 'UTC') {
  const { rows: existing } = await db.query(
    'SELECT * FROM saved_words WHERE id = $1 AND user_id = $2',
    [wordId, userId],
  );

  if (existing.length === 0) return null;

  const card = existing[0];
  const next = computeNextReview(card, answer);

  // Difficulty track (prompt_stage) — fully independent of time scheduling.
  // Moves exactly one stage per review: up on correct, down on incorrect.
  // Stages 0-3: meet word -> translate sentence -> produce word -> produce sentence.
  const currentStage = card.prompt_stage ?? 0;
  let newStage;
  if (answer === 'again') {
    newStage = Math.max(currentStage - 1, 0);
  } else if (answer === 'hard') {
    newStage = currentStage;
  } else {
    // good or easy — advance difficulty
    newStage = Math.min(currentStage + 1, 3);
  }

  // Time track — pure Anki, no overrides
  const finalLearningStep = next.learning_step;
  const finalDueSeconds = next.due_seconds;
  const finalInterval = next.srs_interval;
  const dueDays = Math.max(Math.round(finalDueSeconds / 86400), 1);
  const reviewTimeZone = validTimeZone(timeZone);

  const { rows: updated } = await db.query(
    `UPDATE saved_words
     SET srs_interval = $1,
         ease_factor = $2,
         learning_step = $3,
         due_at = CASE
           WHEN $4::integer < 86400 THEN NOW() + make_interval(secs => $4::double precision)
           ELSE (
             date_trunc('day', NOW() AT TIME ZONE $10)
             + make_interval(days => $11::integer)
           ) AT TIME ZONE $10
         END,
         last_reviewed_at = NOW(),
         correct_count = correct_count + $5,
         incorrect_count = incorrect_count + $6,
         prompt_stage = $7,
         introduced_date = CASE
           WHEN last_reviewed_at IS NULL THEN (NOW() AT TIME ZONE $10)::date
           ELSE introduced_date
         END,
         relearning_date = CASE
           WHEN $12::text = 'again' THEN (NOW() AT TIME ZONE $10)::date
           ELSE relearning_date
         END
     WHERE id = $8 AND user_id = $9
     RETURNING *`,
    [
      finalInterval,
      next.ease_factor,
      finalLearningStep,
      String(finalDueSeconds),
      next.correct_delta,
      next.incorrect_delta,
      newStage,
      wordId,
      userId,
      reviewTimeZone,
      dueDays,
      answer,
    ],
  );

  return updated[0] || null;
}
