export function formatVideoDuration(seconds: number | null): string {
  if (seconds == null) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const CEFR_COLORS: Record<string, string> = {
  A1: '#22a55e', A2: '#22a55e',
  B1: '#3b82f6', B2: '#3b82f6',
  C1: '#8b5cf6', C2: '#8b5cf6',
};
