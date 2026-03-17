import { useCallback, useEffect, useRef, useState } from 'react';

export function useTranscriptAutoScroll(activeIndex: number) {
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const autoScrollRef = useRef(true);
  const hoverPausedRef = useRef(false);

  useEffect(() => {
    if (activeIndex < 0 || !autoScrollRef.current || hoverPausedRef.current) return;
    const container = transcriptRef.current;
    const el = segmentRefs.current[activeIndex];
    if (!container || !el) return;

    // Show one line above the active segment by scrolling to the previous element
    const prevEl = segmentRefs.current[activeIndex - 1];
    const scrollTarget = prevEl ? prevEl.offsetTop : el.offsetTop;

    container.scrollTo({
      top: Math.max(0, scrollTarget),
      behavior: 'smooth',
    });
  }, [activeIndex]);

  const handleTranscriptScroll = useCallback(() => {
    const container = transcriptRef.current;
    if (!container) return;
    const activeEl = segmentRefs.current[activeIndex];
    if (!activeEl) return;

    const threshold = 120;
    const visible =
      activeEl.offsetTop >= container.scrollTop - threshold &&
      (activeEl.offsetTop + activeEl.clientHeight) <= (container.scrollTop + container.clientHeight + threshold);

    autoScrollRef.current = visible;
    setShowScrollBtn(!visible);
  }, [activeIndex]);

  const resetAutoScroll = useCallback(() => {
    autoScrollRef.current = true;
    setShowScrollBtn(false);
  }, []);

  const handleResumeAutoScroll = useCallback(() => {
    resetAutoScroll();
    const container = transcriptRef.current;
    const el = segmentRefs.current[activeIndex];
    if (container && el) {
      const prevEl = segmentRefs.current[activeIndex - 1];
      const scrollTarget = prevEl ? prevEl.offsetTop : el.offsetTop;
      container.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
    }
  }, [activeIndex, resetAutoScroll]);

  const handleWordHoverStart = useCallback(() => {
    hoverPausedRef.current = true;
  }, []);

  const handleWordHoverEnd = useCallback(() => {
    hoverPausedRef.current = false;
  }, []);

  return {
    transcriptRef,
    segmentRefs,
    showScrollBtn,
    handleTranscriptScroll,
    handleResumeAutoScroll,
    resetAutoScroll,
    handleWordHoverStart,
    handleWordHoverEnd,
  };
}
