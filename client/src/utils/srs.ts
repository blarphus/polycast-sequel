// ---------------------------------------------------------------------------
// utils/srs.ts -- SRS interval helpers (client-side)
// ---------------------------------------------------------------------------

const TIME_INTERVALS: Record<number, string> = {
  1: '1 min',
  2: '10 min',
  3: '1 day',
  4: '3 days',
  5: '1 week',
  6: '2 weeks',
  7: '1 month',
  8: '2 months',
  9: '4 months',
};

/**
 * Calculate the next SRS interval for a given answer.
 * - incorrect → reset to 1
 * - correct  → current + 1 (cap 9)
 * - easy     → current + 2 (cap 9)
 */
export function getNextInterval(
  current: number,
  answer: 'incorrect' | 'correct' | 'easy',
): number {
  if (answer === 'incorrect') return 1;
  if (answer === 'correct') return Math.min(current + 1, 9);
  return Math.min(current + 2, 9); // easy
}

/**
 * Human-readable label for the next review time given current interval + answer.
 * Used on the three answer buttons.
 */
export function formatNextReviewTime(
  currentInterval: number,
  answer: 'incorrect' | 'correct' | 'easy',
): string {
  const next = getNextInterval(currentInterval, answer);
  return TIME_INTERVALS[next] || '1 min';
}
