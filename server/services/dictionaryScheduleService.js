import pool from '../db.js';
import logger from '../logger.js';
import { ensureScheduleCurrent } from '../lib/dictionaryQueries.js';
import { normalizeFallbackDiagnostic } from '../lib/fallbackDiagnostics.js';

export function buildScheduleRepairDiagnostic(repair, correlationId) {
  if (!repair?.used || repair.reason === 'local-day-boundary') return null;
  return normalizeFallbackDiagnostic({
    code: 'schedule_repair_used',
    severity: 'info',
    title: 'Study schedule repaired',
    message: 'A recent dictionary change required Polycast to repair the study queue before showing it.',
    source: 'server.dictionary',
    operation: 'refresh-study-schedule',
    detail: `reason=${repair.reason}; overdueCardsAdjusted=${repair.changedCount}`,
  }, { correlationId });
}

export async function refreshDictionarySchedule({
  db = pool,
  userId,
  timeZone,
  options,
  correlationId,
  source = 'read-recovery',
}) {
  const repair = await ensureScheduleCurrent(db, userId, timeZone, options);
  if (!repair.used) return { repair, diagnostic: null };
  if (source === 'mutation') {
    logger.info({
      event: 'schedule_mutation_applied',
      operation: 'refresh-study-schedule',
      correlationId,
      userId,
      timeZone,
      reason: repair.reason,
      overdueCardsAdjusted: repair.changedCount,
    }, 'Study schedule updated after mutation');
    return { repair, diagnostic: null };
  }
  if (repair.reason === 'local-day-boundary') {
    logger.info({
      event: 'schedule_day_boundary_applied',
      operation: 'refresh-study-schedule',
      correlationId,
      userId,
      timeZone,
      overdueCardsAdjusted: repair.changedCount,
    }, 'Daily study schedule boundary applied');
    return { repair, diagnostic: null };
  }
  const diagnostic = buildScheduleRepairDiagnostic(repair, correlationId);
  logger.info({ diagnostic, userId }, 'Study schedule alternate maintenance path used');
  return { repair, diagnostic };
}

/**
 * Commit a schedule-affecting write and its schedule refresh as one unit.
 *
 * The saved_words/users triggers deliberately mark the schedule dirty. Keeping
 * that write and ensureScheduleCurrent in the same transaction means a crash
 * can never commit the dirty flag without also committing the repaired queue.
 * The read-side repair remains available and visible for genuinely out-of-band
 * writes, but ordinary application mutations do not depend on it.
 */
export async function runDictionaryScheduleMutation({
  db = pool,
  userId,
  timeZone = 'UTC',
  correlationId,
  mutate,
}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await mutate(client);
    const schedule = await refreshDictionarySchedule({
      db: client,
      userId,
      timeZone,
      correlationId,
      source: 'mutation',
      options: { withinTransaction: true },
    });
    await client.query('COMMIT');
    return { result, schedule };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
