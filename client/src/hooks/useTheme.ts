// ---------------------------------------------------------------------------
// hooks/useTheme.ts -- ThemeContext, ThemeProvider, useTheme
// ---------------------------------------------------------------------------

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
  createElement,
} from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const STORAGE_KEY = 'polycast-theme';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.dataset.theme = 'dark';
      root.style.setProperty('-webkit-font-smoothing', 'antialiased');
      root.style.setProperty('-moz-osx-font-smoothing', 'grayscale');
    } else {
      delete root.dataset.theme;
      root.style.setProperty('-webkit-font-smoothing', 'auto');
      root.style.setProperty('-moz-osx-font-smoothing', 'auto');
    }
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  return createElement(
    ThemeContext.Provider,
    { value: { theme, toggleTheme } },
    children,
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
