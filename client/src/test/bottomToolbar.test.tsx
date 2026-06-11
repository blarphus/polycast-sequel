import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BottomToolbar from '../components/BottomToolbar';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', account_type: 'student' },
    savedAccounts: [],
    switchAccount: vi.fn(),
    forgetSavedAccount: vi.fn(),
  }),
}));

vi.mock('../api', () => ({
  getStudentDashboard: () => new Promise(() => {}),
}));

describe('BottomToolbar', () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
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
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container.remove();
    root = undefined;
  });

  it('shows only the core destinations until In progress is expanded', () => {
    act(() => {
      root?.render(
        <MemoryRouter
          initialEntries={['/dictionary']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <BottomToolbar />
        </MemoryRouter>,
      );
    });

    const visibleLabels = Array.from(container.querySelectorAll('button')).map((button) => button.textContent?.trim());
    expect(visibleLabels).toContain('Dictionary');
    expect(visibleLabels).toContain('Practice');
    expect(visibleLabels).toContain('Books');
    expect(visibleLabels).not.toContain('Home');

    const inProgress = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('In progress'));
    expect(inProgress).toBeDefined();
    act(() => inProgress?.click());

    const expandedLabels = Array.from(container.querySelectorAll('button')).map((button) => button.textContent?.trim());
    expect(expandedLabels).toContain('Home');
    expect(expandedLabels).toContain('Social');
    expect(expandedLabels).toContain('Watch');
    expect(expandedLabels).toContain('Settings');
  });
});
