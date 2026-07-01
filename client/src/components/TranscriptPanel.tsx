import { useEffect, useRef, useState } from 'react';
import WordPopup from './WordPopup';
import TokenizedText from './TokenizedText';
import type { SaveWordData } from '../api';
import { PopupState } from '../textTokens';
import { speakerColor } from '../utils/speakerColor';

/** Compare primary language subtags: 'pt-BR' matches 'pt'. */
function isSameLanguage(a: string, b: string): boolean {
  return a.toLowerCase().split('-')[0] === b.toLowerCase().split('-')[0];
}

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
  onRemoveWord?: (id: string) => Promise<void>;
  onOptimisticSave?: (word: string) => void;
}

export default function TranscriptPanel({ entries, nativeLang, targetLang, savedWords, isWordSaved, isDefinitionSaved, onSaveWord, onRemoveWord, onOptimisticSave }: TranscriptPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [notTargetRect, setNotTargetRect] = useState<DOMRect | null>(null);
  const notTargetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function handleWordClick(entry: TranscriptEntry) {
    return (e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      // Words outside the learner's target language get a short notice
      // instead of the full lookup flow.
      if (targetLang && entry.lang && !isSameLanguage(entry.lang, targetLang)) {
        setNotTargetRect(rect);
        if (notTargetTimerRef.current) clearTimeout(notTargetTimerRef.current);
        notTargetTimerRef.current = setTimeout(() => setNotTargetRect(null), 1600);
        return;
      }
      setPopup({ word, sentence, rect });
    };
  }

  useEffect(() => {
    return () => {
      if (notTargetTimerRef.current) clearTimeout(notTargetTimerRef.current);
    };
  }, []);

  return (
    <div
      className="transcript-panel"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {entries.length === 0 ? (
        <p className="transcript-empty">Transcript will appear here...</p>
      ) : (
        entries.map((entry) => (
          <div className="transcript-entry" key={entry.id}>
            <span className="transcript-speaker" style={{ color: speakerColor(entry.userId) }}>{entry.displayName}</span>
            {' \u2014 '}
            <span className="transcript-text">
              <TokenizedText text={entry.text} savedWords={savedWords} onWordClick={handleWordClick(entry)} />
            </span>
            {entry.translation && (
              <div className="transcript-translation">{entry.translation}</div>
            )}
          </div>
        ))
      )}
      {notTargetRect && (
        <div
          className="not-target-toast"
          style={{ top: notTargetRect.top - 40, left: notTargetRect.left + notTargetRect.width / 2 }}
        >
          Not in your target language
        </div>
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
          onRemoveWord={onRemoveWord}
          onOptimisticSave={onOptimisticSave}
        />
      )}
    </div>
  );
}
