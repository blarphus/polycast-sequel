import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.hooks.usedictionarytoast');
// ---------------------------------------------------------------------------
// hooks/useDictionaryToast.tsx -- Background dictionary saves with error-only feedback
// ---------------------------------------------------------------------------

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from 'react';

// ---- Types ----------------------------------------------------------------

interface Job {
  word: string;
  status: 'pending' | 'done' | 'error';
}

type Phase = 'idle' | 'error';

interface DictionaryToastContextValue {
  queueSave: (word: string, saveFn: () => Promise<void>) => void;
}

// ---- Context --------------------------------------------------------------

const DictionaryToastContext = createContext<DictionaryToastContextValue | undefined>(undefined);

export function useDictionaryToast(): DictionaryToastContextValue {
  const ctx = useContext(DictionaryToastContext);
  if (ctx === undefined) {
    throw new Error('useDictionaryToast must be used within a DictionaryToastProvider');
  }
  return ctx;
}

// ---- Provider + Toast pill ------------------------------------------------

export function DictionaryToastProvider({ children }: { children: ReactNode }) {
  const jobsRef = useRef<Job[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [label, setLabel] = useState('');
  const [hiding, setHiding] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideAnimRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    if (hideAnimRef.current) { clearTimeout(hideAnimRef.current); hideAnimRef.current = null; }
  };

  const recalc = () => {
    const jobs = jobsRef.current;
    const total = jobs.length;
    const errorCount = jobs.filter(j => j.status === 'error').length;
    const finishedCount = jobs.filter(j => j.status !== 'pending').length;

    if (finishedCount < total) {
      setPhase('idle');
      setHiding(false);
      return;
    }

    if (errorCount === 0) {
      setPhase('idle');
      setHiding(false);
      return;
    }

    if (total === 1) {
      setLabel(`Unable to save ${jobs[0].word}`);
    } else {
      setLabel(`Unable to save ${errorCount} definition${errorCount === 1 ? '' : 's'}`);
    }
    setPhase('error');

    clearTimers();
    hideTimerRef.current = setTimeout(() => {
      setHiding(true);
      hideAnimRef.current = setTimeout(() => {
        setPhase('idle');
        setHiding(false);
      }, 300);
    }, 2500);
  };

  const queueSave = useCallback((word: string, saveFn: () => Promise<void>) => {
    // Clear any pending dismiss timers
    clearTimers();
    setHiding(false);

    // If all previous jobs are finished, start a fresh batch
    const allFinished = jobsRef.current.every(j => j.status === 'done' || j.status === 'error');
    if (allFinished) {
      jobsRef.current = [];
    }

    // Push new job
    const job: Job = { word, status: 'pending' };
    jobsRef.current.push(job);
    recalc();

    // Fire off the save
    saveFn()
      .then(() => { job.status = 'done'; })
      .catch((err) => {
        job.status = 'error';
        runtimeLog.error(`Dictionary save failed for "${word}":`, err);
      })
      .finally(() => { recalc(); });
  }, []);

  return (
    <DictionaryToastContext.Provider value={{ queueSave }}>
      {children}
      {phase !== 'idle' && (
        <div
          className={'dict-toast dict-toast--error' + (hiding ? ' dict-toast--hiding' : '')}
        >
          <span>!</span>
          <span>{label}</span>
        </div>
      )}
    </DictionaryToastContext.Provider>
  );
}
