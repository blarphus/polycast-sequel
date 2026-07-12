import { describe, expect, it } from 'vitest';
import { API_GOLDEN_FIXTURES } from '../generated/apiContract';
import { validCallSignal } from '../contexts/CallProvider';

describe('direct-call generated signaling envelope', () => {
  it('accepts the canonical signal and rejects missing or invalid correlation fields', () => {
    const signal = API_GOLDEN_FIXTURES.callSignal;
    expect(validCallSignal(signal)).toBe(true);
    expect(validCallSignal({ ...signal, correlationId: '' })).toBe(false);
    expect(validCallSignal({ ...signal, occurredAt: 'not-a-date' })).toBe(false);
  });
});
