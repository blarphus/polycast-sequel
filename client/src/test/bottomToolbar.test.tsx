import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BottomToolbar from '../components/BottomToolbar';
import shellStyles from '../styles/shell.css?raw';
import studentsStyles from '../styles/students.css?raw';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const authState = vi.hoisted(() => ({ accountType: 'student' as 'student' | 'teacher' }));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', account_type: authState.accountType },
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
    authState.accountType = 'student';
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

  it('shows Home as the first teacher destination and links it to the teacher landing page', () => {
    authState.accountType = 'teacher';
    act(() => {
      root?.render(
        <MemoryRouter
          initialEntries={['/classes']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <BottomToolbar />
        </MemoryRouter>,
      );
    });

    const destinationLabels = Array.from(
      container.querySelectorAll(':scope > nav > button .toolbar-label'),
    ).map((label) => label.textContent?.trim());
    expect(destinationLabels[0]).toBe('Home');
    expect(container.querySelector('nav > button.active .toolbar-label')?.textContent).toBe('Home');
  });
});

describe('responsive navigation style ownership', () => {
  it('keeps desktop sidebar rules in the globally loaded shell stylesheet', () => {
    expect(shellStyles).toContain('@media (min-width: 481px)');
    expect(shellStyles).toMatch(/@media \(min-width: 481px\)[\s\S]*?\.bottom-toolbar\s*\{[\s\S]*?left:\s*0;/);
    expect(shellStyles).toContain('html.sidebar-visible #root');
    expect(studentsStyles).not.toContain('.bottom-toolbar');
    expect(studentsStyles).not.toContain('.sidebar-in-progress');
  });

  it('opens the desktop In progress menu as a floating panel without moving its anchored row', () => {
    expect(shellStyles).toMatch(/@media \(min-width: 481px\)[\s\S]*?\.sidebar-in-progress-items\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?left:\s*calc\(100% \+ 0\.75rem\);[\s\S]*?bottom:\s*0;/);
    expect(shellStyles).toMatch(/\.bottom-toolbar\.collapsed \.sidebar-in-progress-items \.toolbar-label\s*\{[\s\S]*?display:\s*inline;/);
  });
});
