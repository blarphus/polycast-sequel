export type RuntimeSeverity = 'debug' | 'info' | 'warning' | 'error';

export interface RuntimeDiagnostic {
  code: string;
  severity: RuntimeSeverity;
  source: string;
  operation: string;
  correlationId: string;
  occurredAt: string;
  message: string;
  detail?: string;
}

const SECRET_PATTERN = /(authorization|cookie|password|secret|token|api[-_]?key)\s*[=:]\s*[^;\s,]+/gi;

export function redactRuntimeDetail(value: unknown): string {
  const raw = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? '');
  return raw.replace(SECRET_PATTERN, '$1=[REDACTED]').slice(0, 4_000);
}

export function createRuntimeDiagnostic(input: {
  code: string;
  severity?: RuntimeSeverity;
  source: string;
  operation: string;
  message: string;
  detail?: unknown;
  correlationId?: string;
  visible?: boolean;
}): RuntimeDiagnostic {
  return {
    code: input.code,
    severity: input.severity || 'error',
    source: input.source,
    operation: input.operation,
    correlationId: input.correlationId || globalThis.crypto?.randomUUID?.() || `web-${Date.now()}`,
    occurredAt: new Date().toISOString(),
    message: input.message,
    ...(input.detail === undefined ? {} : { detail: redactRuntimeDetail(input.detail) }),
  };
}

export function logRuntimeDiagnostic(input: Parameters<typeof createRuntimeDiagnostic>[0]) {
  const diagnostic = createRuntimeDiagnostic(input);
  const method = diagnostic.severity === 'error' ? 'error' : diagnostic.severity === 'warning' ? 'warn' : 'info';
  console[method]('[polycast:runtime]', diagnostic);
  if (input.visible && typeof window !== 'undefined' && (diagnostic.severity === 'warning' || diagnostic.severity === 'error')) {
    window.dispatchEvent(new CustomEvent('polycast:fallback', {
      detail: {
        ...diagnostic,
        title: diagnostic.severity === 'error' ? 'Polycast operation failed' : 'Polycast used a guarded path',
      },
    }));
  }
  return diagnostic;
}
