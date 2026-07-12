import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAILY_GOAL_EVENT,
  DEFAULT_DAILY_WORD_GOAL,
  getDailyGoalSnapshot,
  recordDailyWordAdded,
  seedDailyWordProgress,
} from '../utils/dailyGoal';

describe('daily word goal', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    });
  });

  it('defaults to five words and tracks additions', () => {
    expect(getDailyGoalSnapshot()).toEqual({ goal: DEFAULT_DAILY_WORD_GOAL, added: 0, remaining: 5, complete: false });
    seedDailyWordProgress(3);
    recordDailyWordAdded();
    expect(getDailyGoalSnapshot()).toEqual({ goal: 5, added: 4, remaining: 1, complete: false });
  });

  it('announces the transition that completes the goal', () => {
    const listener = vi.fn();
    window.addEventListener(DAILY_GOAL_EVENT, listener);
    seedDailyWordProgress(4);
    recordDailyWordAdded();
    const detail = (listener.mock.calls.at(-1)?.[0] as CustomEvent).detail;
    expect(detail).toMatchObject({ goal: 5, added: 5, remaining: 0, complete: true, justCompleted: true });
    window.removeEventListener(DAILY_GOAL_EVENT, listener);
  });
});
