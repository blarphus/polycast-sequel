import { computeNextReview } from './srsAlgorithm.js';

/**
 * Soft cap on the prompt-stage ladder. Stages 0-3 are the original four
 * (meet / translate / produce word / produce sentence). Each stage beyond 3
 * uses the stage-3 layout with a fresh example sentence generated for that
 * stage, so there is no hard upper limit — this cap is just a safety net
 * against unbounded growth in pathological cases.
 */
export const MAX_PROMPT_STAGE = 20;

/**
 * Apply an SRS review to a saved word.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db - Pool or client
 * @param {string} wordId - saved_words.id
 * @param {string} userId - owner user ID
 * @param {'again'|'good'} answer - binary rating: incorrect or correct
 * @param {string} timeZone - user's IANA timezone for calendar-day intervals
 * @param {object} [options]
 * @param {(args: { db: import('pg').Pool, card: object, newStage: number }) => Promise<void>} [options.onAdvanceToNewStage]
 *   Called when the card advances to a stage that has no entry in
 *   `stage_sentences` yet (i.e. the user just beat the previous stage for the
 *   first time at this height). Implementations are expected to generate a
 *   new example sentence off the request path and persist it. The handler is
 *   invoked synchronously inside applySrsReview, so callers should fire-and-
 *   forget it (`void handler(...).catch(...)`) if they don't want the review
 *   response to wait on Gemini.
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

export async function applySrsReview(
  db,
  wordId,
  userId,
  answer,
  timeZone = 'UTC',
  { onAdvanceToNewStage } = {},
) {
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
  // Stages 4+ reuse the stage-3 layout with a fresh per-stage example sentence.
  const currentStage = card.prompt_stage ?? 0;
  // again (incorrect) drops one stage; good (correct) advances one, soft-capped.
  const newStage = answer === 'again'
    ? Math.max(currentStage - 1, 0)
    : Math.min(currentStage + 1, MAX_PROMPT_STAGE);

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

  // Fire-and-forget: if the card just advanced to a new high stage (>= 4)
  // for the first time, kick off a Gemini call to produce the per-stage
  // example sentence off the request path. Errors are logged but never
  // propagate to the review response — the user will see the card with the
  // stage-2 fallback layout (per FLASHCARDS.md) and we will retry the
  // generation on the next correct answer from the same stage.
  if (
    newStage > currentStage
    && newStage >= 4
    && typeof onAdvanceToNewStage === 'function'
  ) {
    const existingStages = stageStageList(card.stage_sentences);
    if (!existingStages.includes(newStage)) {
      void Promise.resolve()
        .then(() => onAdvanceToNewStage({ db, card, newStage }))
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[srsUpdate] stage-sentence generation failed:', err);
        });
    }
  }

  return updated[0] || null;
}

/**
 * Read the stage numbers present in a saved_words.stage_sentences JSONB value.
 * Robust to null, malformed JSON, and non-array shapes (returns [] in those
 * cases — treat as "no per-stage sentences yet").
 */
function stageStageList(raw) {
  if (raw == null) return [];
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => (entry && typeof entry === 'object' ? entry.stage : null))
    .filter((s) => Number.isInteger(s));
}
