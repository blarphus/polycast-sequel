import { computeNextReview } from './srsAlgorithm.js';
import logger from '../logger.js';
import { normalizeFallbackDiagnostic } from './fallbackDiagnostics.js';
import { MAX_PROMPT_STAGE, SRS_ALGORITHM_VERSION } from './generated/srsContract.js';

export { MAX_PROMPT_STAGE, SRS_ALGORITHM_VERSION } from './generated/srsContract.js';

/**
 * Soft cap on the prompt-stage ladder. Stages 0-3 are the original four
 * (meet / translate / produce word / produce sentence). Each stage beyond 3
 * uses the stage-3 layout with a fresh example sentence generated for that
 * stage, so there is no hard upper limit — this cap is just a safety net
 * against unbounded growth in pathological cases.
 */
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
  } catch (error) {
    const invalidTimeZone = new Error(`Invalid IANA time zone: ${timeZone}`);
    invalidTimeZone.status = 400;
    invalidTimeZone.expose = true;
    invalidTimeZone.cause = error;
    throw invalidTimeZone;
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
           WHEN last_reviewed_at IS NULL AND srs_interval = 0 THEN (NOW() AT TIME ZONE $10)::date
           ELSE introduced_date
         END,
         relearning_date = CASE
           WHEN $12::text = 'again' THEN (NOW() AT TIME ZONE $10)::date
           ELSE NULL
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

  let fallbackNotices = [];
  // Generate the next high-stage sentence before returning so a failure can
  // be represented in both the response UI and structured logs. The review
  // itself remains successful and uses the documented word-production layout.
  if (
    newStage > currentStage
    && newStage >= 4
    && typeof onAdvanceToNewStage === 'function'
  ) {
    const existingStages = stageStageList(card.stage_sentences);
    if (!existingStages.includes(newStage)) {
      try {
        const stageResult = await onAdvanceToNewStage({ db, card, newStage });
        if (Array.isArray(stageResult?.fallback_notices)) {
          fallbackNotices.push(...stageResult.fallback_notices);
        }
      } catch (err) {
        const diagnostic = normalizeFallbackDiagnostic({
          code: 'stage_sentence_generation_fallback',
          severity: 'warning',
          title: 'Practice sentence fallback used',
          message: 'The next stage sentence could not be generated, so this card will use the word-production layout.',
          source: 'server.srs',
          operation: 'advance-prompt-stage',
          detail: `cardId=${wordId}; stage=${newStage}; reason=${err?.message || 'unknown error'}`,
        });
        fallbackNotices = [diagnostic];
        logger.warn({ fallback: diagnostic, err, cardId: wordId, stage: newStage }, 'Stage-sentence fallback used');
      }
    }
  }

  const result = updated[0] || null;
  if (result) {
    result.srs_algorithm_version = SRS_ALGORITHM_VERSION;
    if (fallbackNotices.length > 0) result.fallback_notices = fallbackNotices;
  }
  return result;
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
  } catch (error) {
    logger.warn({
      event: 'stage_sentence_metadata_fallback',
      operation: 'parse-stage-sentences',
      payloadLength: String(raw).length,
      err: error,
    }, 'Malformed stage sentence metadata treated as empty');
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => (entry && typeof entry === 'object' ? entry.stage : null))
    .filter((s) => Number.isInteger(s));
}
