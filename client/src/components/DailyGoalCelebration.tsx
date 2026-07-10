import { useEffect, useRef, useState } from 'react';
import { CheckIcon } from './icons';
import { DAILY_GOAL_EVENT, type DailyGoalSnapshot } from '../utils/dailyGoal';

type Celebration = DailyGoalSnapshot & { justCompleted: boolean; nonce: number };

export default function DailyGoalCelebration() {
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<DailyGoalSnapshot & { justAdded?: boolean; justCompleted?: boolean }>).detail;
      if (!detail?.justAdded) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      setCelebration({ ...detail, justCompleted: !!detail.justCompleted, nonce: Date.now() });
      timerRef.current = setTimeout(() => setCelebration(null), detail.justCompleted ? 3200 : 2200);
    };
    window.addEventListener(DAILY_GOAL_EVENT, onProgress);
    return () => {
      window.removeEventListener(DAILY_GOAL_EVENT, onProgress);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!celebration) return null;

  return (
    <div key={celebration.nonce} className={`goal-celebration${celebration.justCompleted ? ' goal-celebration--complete' : ''}`} role="status">
      <div className="goal-celebration-burst" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} style={{ '--i': index } as React.CSSProperties} />)}
      </div>
      <div className="goal-celebration-icon"><CheckIcon size={22} /></div>
      <div>
        <strong>{celebration.justCompleted ? 'Daily goal complete!' : 'Word added'}</strong>
        <span>{celebration.complete ? `${celebration.added} words added today` : `${celebration.remaining} more to reach today's goal`}</span>
      </div>
    </div>
  );
}
