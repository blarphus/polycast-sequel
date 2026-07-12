// ---------------------------------------------------------------------------
// lib/srsAlgorithm.js -- Anki-style Spaced Repetition algorithm
// ---------------------------------------------------------------------------

import {
  GRADUATING_INTERVAL,
  LEARNING_STEPS,
  MIN_EASE,
  MIN_REVIEW_INTERVAL,
} from './generated/srsContract.js';

function roundedDayInterval(seconds) {
  return Math.max(Math.round(seconds / MIN_REVIEW_INTERVAL), 1) * MIN_REVIEW_INTERVAL;
}

/**
 * Compute the next SRS state for a card given an answer.
 *
 * The rating is binary: 'again' (incorrect) or 'good' (correct). There is no
 * hard/easy — the UI only exposes correct/incorrect.
 * @param {object} card - Current card state from the database
 * @param {'again'|'good'} answer - User's answer
 * @returns {{ srs_interval, ease_factor, learning_step, due_seconds, correct_delta, incorrect_delta }}
 */
export function computeNextReview(card, answer) {
  const isRelearning = card.learning_step !== null && card.srs_interval > 0;
  const isLearning = !isRelearning && (card.learning_step !== null || card.srs_interval === 0);

  let newInterval = card.srs_interval;
  let newEase = card.ease_factor;
  let newStep = card.learning_step;
  let dueSeconds;

  if (isRelearning) {
    // ---- Relearning phase ----
    const step = card.learning_step ?? 0;

    if (answer === 'again') {
      newStep = 0;
      dueSeconds = LEARNING_STEPS[0];
    } else if (step >= LEARNING_STEPS.length - 1) {
      // good on the last relearning step — graduate back out at the stored interval.
      newStep = null;
      dueSeconds = card.srs_interval;
    } else {
      // good — advance to the next relearning step.
      newStep = step + 1;
      dueSeconds = LEARNING_STEPS[step + 1];
    }
  } else if (isLearning) {
    // ---- New-card learning phase ----
    const step = card.learning_step ?? 0;

    if (answer === 'again') {
      newStep = 0;
      dueSeconds = LEARNING_STEPS[0]; // 1 min
    } else if (step >= LEARNING_STEPS.length - 1) {
      // good on the last step — graduate.
      newStep = null;
      newInterval = GRADUATING_INTERVAL;
      dueSeconds = GRADUATING_INTERVAL;
    } else {
      // good — advance to the next learning step.
      newStep = step + 1;
      dueSeconds = LEARNING_STEPS[step + 1];
    }
  } else {
    // ---- Review phase (graduated cards) ----
    const oldInterval = card.srs_interval;

    if (answer === 'again') {
      newEase = Math.max(newEase - 0.20, MIN_EASE);
      // Stock Anki default: New Interval 0%, clamped to the 1-day minimum.
      newInterval = MIN_REVIEW_INTERVAL;
      newStep = 0; // Enter relearning
      dueSeconds = LEARNING_STEPS[0]; // 1 min
    } else {
      // good — grow the interval by the ease factor.
      newInterval = roundedDayInterval(oldInterval * newEase);
      dueSeconds = newInterval;
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
