import { useCallback, useEffect, useRef, useState } from 'react';

export function useTranscriptAutoScroll(activeIndex: number) {
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (activeIndex < 0 || !autoScrollRef.current) return;
    const container = transcriptRef.current;
    const el = segmentRefs.current[activeIndex];
    if (!container || !el) return;

    container.scrollTo({
      top: Math.max(0, el.offsetTop),
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
      container.scrollTo({ top: Math.max(0, el.offsetTop), behavior: 'smooth' });
    }
  }, [activeIndex, resetAutoScroll]);

  return {
    transcriptRef,
    segmentRefs,
    showScrollBtn,
    handleTranscriptScroll,
    handleResumeAutoScroll,
    resetAutoScroll,
  };
}
