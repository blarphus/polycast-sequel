// ---------------------------------------------------------------------------
// lib/srsAlgorithm.js -- Anki-style Spaced Repetition algorithm
// ---------------------------------------------------------------------------

const LEARNING_STEPS = [60, 600];        // 1 min, 10 min
const GRADUATING_INTERVAL = 86400;       // 1 day
const EASY_GRADUATING_INTERVAL = 345600; // 4 days
const RELEARNING_STEP = 600;             // 10 min
const MIN_EASE = 1.3;
const LAPSE_INTERVAL_FACTOR = 0.1;       // Again in review: new = old * 0.1
const MIN_REVIEW_INTERVAL = 86400;       // 1 day minimum

/**
 * Compute the next SRS state for a card given an answer.
 * @param {object} card - Current card state from the database
 * @param {'again'|'hard'|'good'|'easy'} answer - User's answer
 * @returns {{ srs_interval, ease_factor, learning_step, due_seconds, correct_delta, incorrect_delta }}
 */
export function computeNextReview(card, answer) {
  const isLearning = card.learning_step !== null || card.srs_interval === 0;
  const isRelearning = card.learning_step !== null && card.srs_interval > 0;

  let newInterval = card.srs_interval;
  let newEase = card.ease_factor;
  let newStep = card.learning_step;
  let dueSeconds;

  if (isLearning) {
    // ---- Learning / Relearning phase ----
    const step = card.learning_step ?? 0;

    switch (answer) {
      case 'again':
        newStep = 0;
        dueSeconds = LEARNING_STEPS[0]; // 1 min
        break;
      case 'hard':
        newStep = step;
        dueSeconds = step === 0 ? 360 : LEARNING_STEPS[1]; // 6 min or 10 min
        break;
      case 'good':
        if (step >= LEARNING_STEPS.length - 1) {
          // Graduate
          newStep = null;
          if (isRelearning) {
            // Keep existing srs_interval for relearning graduation
            dueSeconds = card.srs_interval;
          } else {
            newInterval = GRADUATING_INTERVAL;
            dueSeconds = GRADUATING_INTERVAL;
          }
        } else {
          newStep = step + 1;
          dueSeconds = LEARNING_STEPS[step + 1];
        }
        break;
      case 'easy':
        newStep = null;
        newInterval = EASY_GRADUATING_INTERVAL;
        newEase = Math.max(newEase + 0.15, MIN_EASE);
        dueSeconds = EASY_GRADUATING_INTERVAL;
        break;
    }
  } else {
    // ---- Review phase (graduated cards) ----
    const oldInterval = card.srs_interval;

    switch (answer) {
      case 'again':
        newEase = Math.max(newEase - 0.20, MIN_EASE);
        newInterval = Math.max(Math.round(oldInterval * LAPSE_INTERVAL_FACTOR), MIN_REVIEW_INTERVAL);
        newStep = 0; // Enter relearning
        dueSeconds = RELEARNING_STEP; // 10 min
        break;
      case 'hard':
        newEase = Math.max(newEase - 0.15, MIN_EASE);
        newInterval = Math.max(Math.round(oldInterval * 1.2), MIN_REVIEW_INTERVAL);
        dueSeconds = newInterval;
        break;
      case 'good':
        newInterval = Math.max(Math.round(oldInterval * newEase), MIN_REVIEW_INTERVAL);
        dueSeconds = newInterval;
        break;
      case 'easy':
        newEase = Math.max(newEase + 0.15, MIN_EASE);
        newInterval = Math.max(Math.round(oldInterval * newEase * 1.3), MIN_REVIEW_INTERVAL);
        dueSeconds = newInterval;
        break;
    }
  }

  return {
    srs_interval: newInterval,
    ease_factor: newEase,
    learning_step: newStep,
    due_seconds: dueSeconds,
    correct_delta: answer === 'again' ? 0 : 1,
    incorrect_delta: answer === 'again' ? 1 : 0,
  };
}
