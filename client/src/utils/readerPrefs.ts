import { createScopedRuntimeLogger } from './scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.utils.readerprefs');
// ---------------------------------------------------------------------------
// utils/readerPrefs.ts -- Per-device EPUB reader preferences (theme, font,
// text size), persisted in localStorage. Deliberately independent of the
// app-wide theme (useTheme) so the reader can be dark while the rest of the
// app stays light, and vice versa.
// ---------------------------------------------------------------------------

export type ReaderTheme = 'light' | 'dark';

export interface ReaderFont {
  id: string;
  label: string;
  stack: string;
}

// System-available fonts only (no web fonts loaded). Georgia is the default.
export const READER_FONTS: ReaderFont[] = [
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'palatino', label: 'Palatino', stack: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
  { id: 'times', label: 'Times', stack: '"Times New Roman", Times, serif' },
  { id: 'iowan', label: 'Iowan', stack: '"Iowan Old Style", Iowan, Charter, Georgia, serif' },
  { id: 'sans', label: 'Sans', stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
];

export const DEFAULT_FONT_ID = 'georgia';

export interface ReaderPrefs {
  theme: ReaderTheme;
  fontId: string;
  fontScale: number;
}

const STORAGE_KEY = 'polycast-reader-prefs';
const DEFAULT_PREFS: ReaderPrefs = { theme: 'light', fontId: DEFAULT_FONT_ID, fontScale: 1 };

export function fontStack(fontId: string): string {
  const found = READER_FONTS.find((f) => f.id === fontId);
  return (found ?? READER_FONTS[0]).stack;
}

export function loadReaderPrefs(): ReaderPrefs {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      fontId: READER_FONTS.some((f) => f.id === parsed.fontId) ? parsed.fontId! : DEFAULT_FONT_ID,
      fontScale: typeof parsed.fontScale === 'number' ? parsed.fontScale : 1,
    };
  } catch (err) {
    // Corrupt storage shouldn't break the reader — surface it and fall back to defaults.
    runtimeLog.error('readerPrefs: failed to parse stored prefs:', err);
    return { ...DEFAULT_PREFS };
  }
}

export function saveReaderPrefs(prefs: ReaderPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
