// ---------------------------------------------------------------------------
// hooks/useFullscreen.ts — Manage fullscreen state for a container element
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, RefObject } from 'react';

export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, [ref]);

  return { isFullscreen, toggleFullscreen };
}
