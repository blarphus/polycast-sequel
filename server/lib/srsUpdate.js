import { computeNextReview } from './srsAlgorithm.js';

/**
 * Apply an SRS review to a saved word.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db - Pool or client
 * @param {string} wordId - saved_words.id
 * @param {string} userId - owner user ID
 * @param {'again'|'hard'|'good'|'easy'} answer
 * @returns {Promise<object|null>} Updated row, or null if not found
 */
export async function applySrsReview(db, wordId, userId, answer) {
  const { rows: existing } = await db.query(
    'SELECT * FROM saved_words WHERE id = $1 AND user_id = $2',
    [wordId, userId],
  );

  if (existing.length === 0) return null;

  const card = existing[0];
  const next = computeNextReview(card, answer);

  // Advance / retreat prompt_stage based on answer quality
  const currentStage = card.prompt_stage ?? 0;
  let newStage;
  if (answer === 'again') {
    newStage = Math.max(currentStage - 1, 0);
  } else if (answer === 'hard') {
    newStage = currentStage;
  } else {
    newStage = Math.min(currentStage + 1, 4);
  }

  // When prompt_stage advances to a new prompt type, reset learning
  // so the user must go through learning steps for the new prompt.
  let finalLearningStep = next.learning_step;
  let finalDueSeconds = next.due_seconds;
  let finalInterval = next.srs_interval;
  if (newStage > currentStage && next.learning_step === null) {
    // Card was about to graduate, but there's a new prompt type to learn.
    // Reset to learning step 0 so it comes back in 1 min for the new prompt.
    finalLearningStep = 0;
    finalDueSeconds = 60;
    finalInterval = 0;
  }

  const { rows: updated } = await db.query(
    `UPDATE saved_words
     SET srs_interval = $1,
         ease_factor = $2,
         learning_step = $3,
         due_at = NOW() + ($4 || ' seconds')::INTERVAL,
         last_reviewed_at = NOW(),
         correct_count = correct_count + $5,
         incorrect_count = incorrect_count + $6,
         prompt_stage = $7,
         introduced_date = CASE WHEN last_reviewed_at IS NULL THEN CURRENT_DATE ELSE introduced_date END
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
    ],
  );

  return updated[0] || null;
}
