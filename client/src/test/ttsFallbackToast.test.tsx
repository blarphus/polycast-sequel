import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FallbackToast from '../components/FallbackToast';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('FallbackToast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('warns when OpenAI fallback speech is used and dismisses itself', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<FallbackToast />));

    act(() => {
      window.dispatchEvent(new CustomEvent('polycast:tts-fallback', {
        detail: { languageCode: 'fr' },
      }));
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Cloudflare does not support French yet. Using the OpenAI voice fallback.',
    );

    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(container.querySelector('[role="status"]')).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it('shows generic fallback notices with failure detail', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<FallbackToast />));

    act(() => {
      window.dispatchEvent(new CustomEvent('polycast:fallback', {
        detail: {
          title: 'Example fallback used',
          message: 'Image-grounded example generation failed.',
          detail: 'Keeping the original example sentence.',
        },
      }));
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Example fallback usedImage-grounded example generation failed. Keeping the original example sentence.',
    );

    act(() => root.unmount());
    container.remove();
  });

  it('does not replay the same server fallback correlation on navigation', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<FallbackToast />));
    const detail = {
      code: 'schedule_repair_used',
      severity: 'info',
      title: 'Study schedule repaired',
      message: 'A dictionary change required a repair.',
      correlationId: 'one-repair',
    };

    act(() => {
      window.dispatchEvent(new CustomEvent('polycast:fallback', { detail }));
      vi.advanceTimersByTime(6000);
      window.dispatchEvent(new CustomEvent('polycast:fallback', { detail }));
      vi.advanceTimersByTime(1000);
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });
});
