import React, { useEffect, useRef } from 'react';

export interface TranscriptEntry {
  userId: string;
  displayName: string;
  text: string;
}

interface TranscriptPanelProps {
  entries: TranscriptEntry[];
}

export default function TranscriptPanel({ entries }: TranscriptPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Track whether user has scrolled up
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 40;
    shouldAutoScroll.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
  };

  // Auto-scroll when new entries arrive
  useEffect(() => {
    if (shouldAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div
      className="transcript-panel"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {entries.length === 0 ? (
        <p className="transcript-empty">Transcript will appear here...</p>
      ) : (
        entries.map((entry, i) => (
          <div className="transcript-entry" key={i}>
            <span className="transcript-speaker">{entry.displayName}</span>
            {' \u2014 '}
            <span className="transcript-text">{entry.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
