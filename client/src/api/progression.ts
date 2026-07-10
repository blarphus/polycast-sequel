import { request } from './core';

export interface ProgressionSnapshot {
  totalXp: number;
  dailyGoal: { goal: number; added: number; remaining: number; complete: boolean; wordSaveXpRemaining: number };
  wildRecall: { answered: number; remaining: number };
}

export function getProgression() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return request<ProgressionSnapshot>(`/progression?timeZone=${encodeURIComponent(timeZone)}`, { cacheTtlMs: 10_000 });
}
