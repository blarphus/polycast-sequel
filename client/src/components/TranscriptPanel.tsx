import React, { useEffect, useRef, useState } from 'react';
import WordPopup from './WordPopup';
import { tokenize, isWordToken, PopupState } from '../textTokens';

export interface TranscriptEntry {
  id?: number;
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
  onSaveWord?: (data: {
    word: string;
    translation: string;
    definition: string;
    target_language?: string;
    sentence_context?: string;
    frequency?: number | null;
    example_sentence?: string | null;
    part_of_speech?: string | null;
  }) => void;
}

export default function TranscriptPanel({ entries, nativeLang, targetLang, savedWords, isWordSaved, onSaveWord }: TranscriptPanelProps) {
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

  function renderTokenized(text: string) {
    return tokenize(text).map((token, i) =>
      isWordToken(token) ? (
        <span
          key={i}
          className={`subtitle-word${savedWords?.has(token.toLowerCase()) ? ' saved' : ''}`}
          onClick={(e) => handleWordClick(e, token, text)}
        >
          {token}
        </span>
      ) : (
        <span key={i}>{token}</span>
      ),
    );
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
          <div className="transcript-entry" key={entry.id ?? i}>
            <span className="transcript-speaker">{entry.displayName}</span>
            {' \u2014 '}
            <span className="transcript-text">{renderTokenized(entry.text)}</span>
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
          isWordSaved={isWordSaved ? isWordSaved(popup.word) : undefined}
          onSaveWord={onSaveWord}
        />
      )}
    </div>
  );
}
