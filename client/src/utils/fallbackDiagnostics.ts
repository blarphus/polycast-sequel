import type { APIContractFallbackDiagnostic } from '../generated/apiContract';

export interface FallbackDiagnostic extends APIContractFallbackDiagnostic {
  languageCode?: string;
}

function correlationId() {
  return globalThis.crypto?.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeFallbackDiagnostic(
  input: Partial<FallbackDiagnostic> | undefined,
  defaults: Pick<FallbackDiagnostic, 'source' | 'operation'>,
): FallbackDiagnostic {
  return {
    code: input?.code || 'fallback_used',
    severity: input?.severity || 'warning',
    title: input?.title || 'Fallback used',
    message: input?.message || 'Polycast used an alternate path.',
    source: input?.source || defaults.source,
    operation: input?.operation || defaults.operation,
    correlationId: input?.correlationId || correlationId(),
    occurredAt: input?.occurredAt || new Date().toISOString(),
    ...(input?.detail ? { detail: input.detail } : {}),
    ...(input?.languageCode ? { languageCode: input.languageCode } : {}),
  };
}

export function emitFallbackDiagnostic(
  input: Partial<FallbackDiagnostic>,
  defaults: Pick<FallbackDiagnostic, 'source' | 'operation'>,
) {
  const diagnostic = normalizeFallbackDiagnostic(input, defaults);
  console.warn('[polycast:fallback]', diagnostic);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('polycast:fallback', { detail: diagnostic }));
  }
  return diagnostic;
}
