import { request } from './core';

export interface ProgressionSnapshot {
  totalXp: number;
  dailyActivity: { targetXp: number; earnedXp: number; remainingXp: number; complete: boolean };
  dailyGoal: { goal: number; added: number; remaining: number; complete: boolean; wordSaveXpRemaining: number };
  wildRecall: { answered: number; remaining: number };
  sessionRewards: { awarded: number; remaining: number };
  week: { date: string; xp: number; complete: boolean }[];
  level: {
    number: number;
    currentXp: number;
    nextXp: number;
    selectedAccent: 'indigo' | 'teal' | 'coral' | 'gold';
    unlockedAccents: ('indigo' | 'teal' | 'coral' | 'gold')[];
  };
}

export function setProgressionAccent(accent: ProgressionSnapshot['level']['selectedAccent']) {
  return request<ProgressionSnapshot>('/progression/accent', {
    method: 'PATCH',
    body: { accent, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
}

export function getProgression() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return request<ProgressionSnapshot>(`/progression?timeZone=${encodeURIComponent(timeZone)}`, { cacheTtlMs: 10_000 });
}
