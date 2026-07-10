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
  title?: string;
}

function languageName(code?: string) {
  if (!code) return 'Detecting';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export default function TranscriptPanel({ entries, nativeLang, targetLang, savedWords, isWordSaved, isDefinitionSaved, onSaveWord, onRemoveWord, onOptimisticSave, title = 'Live transcript' }: TranscriptPanelProps) {
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

  const recentLanguages = Array.from(new Set(entries.slice(-12).map((entry) => entry.lang).filter(Boolean))) as string[];

  return (
    <div
      className="transcript-panel"
      ref={containerRef}
      onScroll={handleScroll}
    >
      <div className="transcript-header">
        <div>
          <span className="transcript-kicker">Conversation</span>
          <strong>{title}</strong>
        </div>
        <div className="transcript-languages">
          {(recentLanguages.length > 0 ? recentLanguages : targetLang ? [targetLang] : []).map((lang) => (
            <span className="transcript-language-chip" key={lang}><i />{languageName(lang)}</span>
          ))}
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="transcript-empty"><span className="transcript-listening-dot" />Listening for speech...</div>
      ) : (
        entries.map((entry) => (
          <div className="transcript-entry" key={entry.id}>
            <div className="transcript-entry-rail" style={{ backgroundColor: speakerColor(entry.userId) }} />
            <div className="transcript-entry-content">
              <div className="transcript-entry-meta">
                <span className="transcript-speaker" style={{ color: speakerColor(entry.userId) }}>{entry.displayName}</span>
                {entry.lang && <span className="transcript-entry-language">{languageName(entry.lang)}</span>}
              </div>
              <div className="transcript-text">
                <TokenizedText text={entry.text} savedWords={savedWords} onWordClick={handleWordClick(entry)} />
              </div>
            {entry.translation && (
              <div className="transcript-translation">{entry.translation}</div>
            )}
            </div>
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
