import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { request, setApiSessionActive } from '../api/core';

const apiMocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  getProfileAccounts: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  getMe: apiMocks.getMe,
  getProfileAccounts: apiMocks.getProfileAccounts,
}));

function Probe({ publish }: { publish: (value: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  useEffect(() => publish(auth), [auth, publish]);
  return <div data-user={auth.user?.id || ''} data-error={auth.authError} />;
}

describe('central session expiration', () => {
  let root: Root;
  let container: HTMLDivElement;
  let latest: ReturnType<typeof useAuth> | null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    latest = null;
    const storage = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
    setApiSessionActive(false);
    apiMocks.getMe.mockResolvedValue({
      id: 'user-1', username: 'learner', display_name: 'Learner',
      native_language: 'en', target_language: 'es', account_type: 'student',
    });
    apiMocks.getProfileAccounts.mockResolvedValue({ accounts: [{ id: 'user-1', username: 'learner' }] });
    vi.stubGlobal('fetch', vi.fn());
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setApiSessionActive(false);
  });

  it('clears the authenticated shell and emits one detailed visible diagnostic on 401', async () => {
    const fallbackEvents: CustomEvent[] = [];
    const onFallback = (event: Event) => fallbackEvents.push(event as CustomEvent);
    window.addEventListener('polycast:fallback', onFallback);
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url, options: RequestInit) => {
      const correlationId = (options.headers as Record<string, string>)['X-Correlation-ID'];
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'X-Correlation-ID': correlationId },
      });
    });

    await act(async () => root.render(
      <AuthProvider><Probe publish={(value) => { latest = value; }} /></AuthProvider>,
    ));
    expect(latest!.user?.id).toBe('user-1');
    // The provider marks the request layer active with the restored user. Set
    // the explicit boundary here as well so this test is independent of React
    // effect scheduling while still exercising the real expiration event.
    setApiSessionActive(true);

    let results: PromiseSettledResult<unknown>[] = [];
    await act(async () => {
      results = await Promise.allSettled([request('/dictionary/words'), request('/progression')]);
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(latest!.user).toBeNull();
    expect(latest!.savedAccounts).toEqual([]);
    expect(latest!.authError).toContain('signed this browser out');
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0].detail).toMatchObject({
      code: 'session_expired', source: 'web.api', operation: 'invalidate-session', severity: 'error',
    });
    expect(fallbackEvents[0].detail.detail).toContain('status=401');
    const sentCorrelations = (fetch as ReturnType<typeof vi.fn>).mock.calls.map(([, options]) =>
      (options.headers as Record<string, string>)['X-Correlation-ID']);
    expect(sentCorrelations).toContain(fallbackEvents[0].detail.correlationId);
    window.removeEventListener('polycast:fallback', onFallback);
  });

  it('does not label the anonymous startup probe as an expired session', async () => {
    apiMocks.getMe.mockRejectedValue(new Error('Unauthorized'));
    const fallback = vi.fn();
    window.addEventListener('polycast:fallback', fallback);
    await act(async () => root.render(
      <AuthProvider><Probe publish={(value) => { latest = value; }} /></AuthProvider>,
    ));
    expect(latest!.user).toBeNull();
    expect(fallback).not.toHaveBeenCalled();
    window.removeEventListener('polycast:fallback', fallback);
  });
});
