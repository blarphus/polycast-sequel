// ---------------------------------------------------------------------------
// utils/classSchedule.ts -- Helpers for the "Next class" countdown tile.
// ---------------------------------------------------------------------------

import type { UpcomingClass } from '../api';

/** Students can join this long before the scheduled start. */
export const JOIN_WINDOW_MS = 15 * 60_000;

/**
 * Concrete start Date of a session returned by /api/classes/today.
 * One-off sessions carry scheduled_at; recurring ones carry a "HH:MM" time
 * for today.
 */
export function classStartDate(c: UpcomingClass): Date | null {
  if (c.scheduled_at) return new Date(c.scheduled_at);
  if (c.time) {
    const match = c.time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const d = new Date();
    d.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return d;
  }
  return null;
}

/** "2h 14m", "8m 30s", or "Happening now" once the start time has passed. */
export function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return 'Happening now';
  const totalSeconds = Math.floor(msLeft / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `in ${h}h ${m}m`;
  if (m >= 10) return `in ${m}m`;
  if (m > 0) return `in ${m}m ${s}s`;
  return `in ${s}s`;
}
