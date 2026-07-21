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
}) {
  const repair = await ensureScheduleCurrent(db, userId, timeZone, options);
  if (!repair.used) return { repair, diagnostic: null };
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
