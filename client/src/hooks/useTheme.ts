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
type BgTexture = 'none' | 'dots' | 'lines' | 'noise' | 'grid';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  bgTexture: BgTexture;
  setBgTexture: (t: BgTexture) => void;
}

const STORAGE_KEY = 'polycast-theme';
const TEXTURE_KEY = 'polycast-bg-texture';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const VALID_TEXTURES: BgTexture[] = ['none', 'dots', 'lines', 'noise', 'grid'];

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'dark' ? 'dark' : 'light';
  });

  const [bgTexture, setBgTextureState] = useState<BgTexture>(() => {
    const stored = localStorage.getItem(TEXTURE_KEY);
    return VALID_TEXTURES.includes(stored as BgTexture) ? (stored as BgTexture) : 'none';
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

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.bgTexture = bgTexture;
    localStorage.setItem(TEXTURE_KEY, bgTexture);
  }, [bgTexture]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const setBgTexture = useCallback((t: BgTexture) => {
    setBgTextureState(t);
  }, []);

  return createElement(
    ThemeContext.Provider,
    { value: { theme, toggleTheme, bgTexture, setBgTexture } },
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
