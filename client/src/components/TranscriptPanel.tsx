import React, { useEffect, useRef, useState } from 'react';
import WordPopup from './WordPopup';
import TokenizedText from './TokenizedText';
import type { SaveWordData } from '../api';
import { PopupState } from '../textTokens';

export interface TranscriptEntry {
  id: number;
  userId: string;
  displayName: string;
  text: string;
  lang?: string;
  translation?: string;
}

interface TranscriptPanelProps {
  entries: TranscriptEntry[];
  nativeLang?: string;
  targetLang?: string;
  savedWords?: Set<string>;
  isWordSaved?: (word: string) => boolean;
  isDefinitionSaved?: (word: string, definition: string) => boolean;
  onSaveWord?: (data: SaveWordData) => Promise<{ _created: boolean }>;
}

export default function TranscriptPanel({ entries, nativeLang, targetLang, savedWords, isWordSaved, isDefinitionSaved, onSaveWord }: TranscriptPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const [popup, setPopup] = useState<PopupState | null>(null);

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

  function handleWordClick(e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({ word, sentence, rect });
  }

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
          <div className="transcript-entry" key={entry.id}>
            <span className="transcript-speaker">{entry.displayName}</span>
            {' \u2014 '}
            <span className="transcript-text">
              <TokenizedText text={entry.text} savedWords={savedWords} onWordClick={handleWordClick} />
            </span>
            {entry.translation && (
              <div className="transcript-translation">{entry.translation}</div>
            )}
          </div>
        ))
      )}
      {popup && nativeLang && (
        <WordPopup
          word={popup.word}
          sentence={popup.sentence}
          nativeLang={nativeLang}
          targetLang={targetLang}
          anchorRect={popup.rect}
          onClose={() => setPopup(null)}
          isWordSaved={isWordSaved}
          isDefinitionSaved={isDefinitionSaved}
          onSaveWord={onSaveWord}
        />
      )}
    </div>
  );
}
