import { setFallbackDiagnosticHeader } from '../../lib/fallbackDiagnostics.js';
import { refreshDictionarySchedule } from '../../services/dictionaryScheduleService.js';

export async function refreshScheduleIfNeeded(req, res, timeZone, options) {
  const outcome = await refreshDictionarySchedule({
    userId: req.userId, timeZone, options, correlationId: req.id,
  });
  if (outcome.diagnostic) setFallbackDiagnosticHeader(res, outcome.diagnostic);
  return outcome.repair;
}
