import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Manages auto-hiding controls after 3 seconds of inactivity.
 * Returns state + a callback to show/reset the timer.
 */
export function useAutoHideControls() {
  const [controlsHidden, setControlsHidden] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showControls = useCallback(() => {
    setControlsHidden(false);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsHidden(true), 3000);
  }, []);

  useEffect(() => {
    hideTimerRef.current = setTimeout(() => setControlsHidden(true), 3000);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return { controlsHidden, showControls };
}
