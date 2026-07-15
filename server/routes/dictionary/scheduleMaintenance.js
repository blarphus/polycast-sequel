import { setFallbackDiagnosticHeader } from '../../lib/fallbackDiagnostics.js';
import { refreshDictionarySchedule } from '../../services/dictionaryScheduleService.js';

export async function refreshScheduleIfNeeded(req, res, timeZone, options) {
  // Schedule-aware reads mutate daily boundary state and can carry a repair
  // diagnostic. Neither the body nor its headers may be replayed from cache.
  res.setHeader('Cache-Control', 'private, no-store');
  const outcome = await refreshDictionarySchedule({
    userId: req.userId, timeZone, options, correlationId: req.id,
  });
  if (outcome.diagnostic) setFallbackDiagnosticHeader(res, outcome.diagnostic);
  return outcome.repair;
}
