import { describe, expect, it, vi } from 'vitest';
import { createRuntimeDiagnostic, logRuntimeDiagnostic, redactRuntimeDetail } from '../utils/runtimeDiagnostics';

describe('runtime diagnostics', () => {
  it('redacts credentials and retains structured correlation fields', () => {
    expect(redactRuntimeDetail('authorization=Bearer-secret password=hunter2 token=abc')).toBe(
      'authorization=[REDACTED] password=[REDACTED] token=[REDACTED]',
    );
    const diagnostic = createRuntimeDiagnostic({
      code: 'request_failed', source: 'web.test', operation: 'load', message: 'Load failed',
      correlationId: 'correlation-1', detail: 'apiKey=secret-value',
    });
    expect(diagnostic).toMatchObject({
      code: 'request_failed', source: 'web.test', operation: 'load', correlationId: 'correlation-1',
      detail: 'apiKey=[REDACTED]',
    });
  });

  it('emits one machine-readable runtime record', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const diagnostic = logRuntimeDiagnostic({
      code: 'example_failed', source: 'web.test', operation: 'example', message: 'Example failed',
    });
    expect(error).toHaveBeenCalledWith('[polycast:runtime]', diagnostic);
    error.mockRestore();
  });
});
