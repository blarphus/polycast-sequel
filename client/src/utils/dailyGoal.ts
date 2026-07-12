import { emitFallbackDiagnostic } from './fallbackDiagnostics';

export const DEFAULT_DAILY_WORD_GOAL = 5;
export const DAILY_GOAL_EVENT = 'polycast:daily-word-goal';

const GOAL_KEY = 'polycast.daily-word-goal.v1';
const PROGRESS_KEY = 'polycast.daily-word-progress.v1';

export interface DailyGoalSnapshot {
  goal: number;
  added: number;
  remaining: number;
  complete: boolean;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function readProgress(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const value = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) || '{}') as { date?: string; count?: number };
    return value.date === todayKey() ? Math.max(0, Number(value.count) || 0) : 0;
  } catch (error) {
    emitFallbackDiagnostic({
      code: 'daily_goal_storage_repaired',
      severity: 'warning',
      title: 'Daily goal progress repaired',
      message: 'Stored daily-goal progress was malformed, so today\'s local counter was reset to zero.',
      detail: error instanceof Error ? error.message : String(error),
    }, { source: 'web.daily-goal', operation: 'read-local-progress' });
    return 0;
  }
}

function writeProgress(count: number) {
  window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({ date: todayKey(), count }));
}

export function getDailyWordGoal(): number {
  if (typeof window === 'undefined') return DEFAULT_DAILY_WORD_GOAL;
  const stored = Number(window.localStorage.getItem(GOAL_KEY));
  return Number.isFinite(stored) && stored > 0 ? Math.round(stored) : DEFAULT_DAILY_WORD_GOAL;
}

export function getDailyGoalSnapshot(): DailyGoalSnapshot {
  const goal = getDailyWordGoal();
  const added = readProgress();
  return { goal, added, remaining: Math.max(0, goal - added), complete: added >= goal };
}

function emit(snapshot: DailyGoalSnapshot, justAdded = false, justCompleted = false) {
  window.dispatchEvent(new CustomEvent(DAILY_GOAL_EVENT, {
    detail: { ...snapshot, justAdded, justCompleted },
  }));
}

export function seedDailyWordProgress(count: number) {
  if (typeof window === 'undefined') return;
  const normalized = Math.max(0, Math.round(count));
  if (normalized === readProgress()) return;
  writeProgress(normalized);
  emit(getDailyGoalSnapshot());
}

export function applyAccountDailyGoal(snapshot: DailyGoalSnapshot) {
  if (typeof window === 'undefined' || !snapshot) return;
  const before = getDailyGoalSnapshot();
  const goal = Math.max(1, Math.round(Number(snapshot.goal) || DEFAULT_DAILY_WORD_GOAL));
  window.localStorage.setItem(GOAL_KEY, String(goal));
  writeProgress(Math.max(0, Math.round(Number(snapshot.added) || 0)));
  emit({ ...snapshot, goal }, true, !before.complete && snapshot.complete);
}

export function recordDailyWordAdded() {
  if (typeof window === 'undefined') return;
  const before = getDailyGoalSnapshot();
  writeProgress(before.added + 1);
  const after = getDailyGoalSnapshot();
  emit(after, true, !before.complete && after.complete);
}
