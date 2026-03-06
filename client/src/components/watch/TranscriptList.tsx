import React from 'react';
import type { TranscriptSegment } from '../../api';
import TokenizedText from '../TokenizedText';
import { ArrowDownIcon } from '../icons';

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface TranscriptListProps {
  mergedSegments: TranscriptSegment[];
  activeIndex: number;
  savedWords: Set<string>;
  onWordClick: (e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) => void;
  onTimestampClick: (offset: number) => void;
  transcriptRef: React.RefObject<HTMLDivElement>;
  segmentRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  showScrollBtn: boolean;
  onTranscriptScroll: () => void;
  onResumeAutoScroll: () => void;
}

export default function TranscriptList({
  mergedSegments,
  activeIndex,
  savedWords,
  onWordClick,
  onTimestampClick,
  transcriptRef,
  segmentRefs,
  showScrollBtn,
  onTranscriptScroll,
  onResumeAutoScroll,
}: TranscriptListProps) {
  return (
    <div className="watch-transcript-wrapper">
      <div
        className="watch-transcript"
        ref={transcriptRef}
        onScroll={onTranscriptScroll}
      >
        {mergedSegments.map((seg, i) => (
          <div
            key={i}
            ref={(el) => { segmentRefs.current[i] = el; }}
            className={`watch-segment${i === activeIndex ? ' watch-segment--active' : ''}`}
          >
            <button
              className="watch-segment-time"
              onClick={() => onTimestampClick(seg.offset)}
            >
              {formatTimestamp(seg.offset)}
            </button>
            <span className="watch-segment-text">
              <TokenizedText
                text={seg.text}
                savedWords={savedWords}
                onWordClick={onWordClick}
              />
            </span>
          </div>
        ))}
      </div>
      {showScrollBtn && (
        <button className="watch-scroll-btn" onClick={onResumeAutoScroll} title="Resume auto-scroll">
          <ArrowDownIcon size={18} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
