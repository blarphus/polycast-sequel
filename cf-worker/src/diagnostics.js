export function createDiagnostic({ code, severity = 'warning', title, message, operation, correlationId, detail }) {
  const diagnostic = {
    code,
    severity,
    title,
    message,
    source: 'worker.media',
    operation,
    correlationId: correlationId || crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };
  console.warn(JSON.stringify({ event: 'worker_diagnostic', diagnostic }));
  return diagnostic;
}

export function fallbackDiagnostic(input) {
  return createDiagnostic(input);
}
