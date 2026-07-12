import { logRuntimeDiagnostic, type RuntimeSeverity } from './runtimeDiagnostics';

function operationFrom(values: unknown[]) {
  const label = typeof values[0] === 'string' ? values[0] : 'runtime-event';
  return label
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80) || 'runtime-event';
}

function messageFrom(values: unknown[]) {
  const first = values[0];
  return (typeof first === 'string' ? first.replace(/^\[[^\]]+\]\s*/, '') : 'Polycast runtime event')
    .slice(0, 240);
}

function detailFrom(values: unknown[]) {
  return values.map((value) => value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? '')).join(' | ');
}

export function createScopedRuntimeLogger(source: string) {
  const write = (severity: RuntimeSeverity, values: unknown[]) => logRuntimeDiagnostic({
    code: `runtime_${severity}`,
    severity,
    source,
    operation: operationFrom(values),
    message: messageFrom(values),
    detail: detailFrom(values),
  });
  return {
    error: (...values: unknown[]) => write('error', values),
    warn: (...values: unknown[]) => write('warning', values),
    info: (...values: unknown[]) => write('info', values),
    log: (...values: unknown[]) => write('info', values),
    debug: (...values: unknown[]) => write('debug', values),
  };
}
