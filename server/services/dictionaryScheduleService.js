import pool from '../db.js';
import logger from '../logger.js';
import { ensureScheduleCurrent } from '../lib/dictionaryQueries.js';
import { normalizeFallbackDiagnostic } from '../lib/fallbackDiagnostics.js';

export async function refreshDictionarySchedule({
  db = pool,
  userId,
  timeZone,
  options,
  correlationId,
}) {
  const repair = await ensureScheduleCurrent(db, userId, timeZone, options);
  if (!repair.used) return { repair, diagnostic: null };
  const dayBoundary = repair.reason === 'local-day-boundary';
  const diagnostic = normalizeFallbackDiagnostic({
    code: dayBoundary ? 'schedule_day_boundary_applied' : 'schedule_repair_used',
    severity: 'info',
    title: dayBoundary ? 'Daily study schedule refreshed' : 'Study schedule repaired',
    message: dayBoundary
      ? 'Polycast refreshed the study queue for the new local day.'
      : 'A recent dictionary change required Polycast to repair the study queue before showing it.',
    source: 'server.dictionary',
    operation: 'refresh-study-schedule',
    detail: `reason=${repair.reason}; overdueCardsAdjusted=${repair.changedCount}`,
  }, { correlationId });
  logger.info({ diagnostic, userId }, 'Study schedule alternate maintenance path used');
  return { repair, diagnostic };
}
