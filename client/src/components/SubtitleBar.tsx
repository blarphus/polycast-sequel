// ---------------------------------------------------------------------------
// components/SubtitleBar.tsx -- Subtitle overlay with scrolling lines
// ---------------------------------------------------------------------------

import React, { useState, useRef, useEffect } from 'react';
import WordPopup from './WordPopup';
import { tokenize, isWordToken, PopupState } from '../textTokens';

interface SubtitleBarProps {
  localText: string;
  remoteText: string;
  remoteLang: string;
  nativeLang?: string;
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

function langLabel(lang: string): string {
  if (!lang) return '';
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'language' });
    const base = lang.split('-')[0];
    return display.of(base) ?? lang;
  } catch {
    return lang;
  }
}

/**
 * Hook that accumulates subtitle lines from a streaming text signal.
 * - While `text` is non-empty, the last line is updated in-place (Voxtral rebuilds the full utterance).
 * - When `text` becomes empty, the last line is frozen.
 * - When `text` transitions empty -> non-empty, a new line is pushed.
 * - Lines never disappear.
 */
function useSubtitleLines(text: string): string[] {
  const linesRef = useRef<string[]>([]);
  const prevTextRef = useRef('');
  const [, forceRender] = useState(0);

  useEffect(() => {
    const prev = prevTextRef.current;
    prevTextRef.current = text;

    if (text) {
      if (!prev) {
        // empty -> non-empty: push a new line
        linesRef.current = [...linesRef.current, text];
      } else {
        // non-empty -> non-empty: update last line in place
        const updated = [...linesRef.current];
        updated[updated.length - 1] = text;
        linesRef.current = updated;
      }
      forceRender((n) => n + 1);
    }
    // When text becomes empty, we just freeze (do nothing)
  }, [text]);

  return linesRef.current;
}

export default function SubtitleBar({ localText, remoteText, remoteLang, nativeLang, savedWords, isWordSaved, onSaveWord }: SubtitleBarProps) {
  const [popup, setPopup] = useState<PopupState | null>(null);

  const localLines = useSubtitleLines(localText);
  const remoteLines = useSubtitleLines(remoteText);

  const visibleLocal = localLines.slice(-2);
  const visibleRemote = remoteLines.slice(-2);

  const hasContent = visibleLocal.length > 0 || visibleRemote.length > 0;
  if (!hasContent) return null;

  function handleWordClick(e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({ word, sentence, rect });
  }

  function renderTokenized(text: string) {
    return (
      <span className="subtitle-text">
        {tokenize(text).map((token, i) =>
          isWordToken(token) ? (
            <span key={i} className={`subtitle-word${savedWords?.has(token.toLowerCase()) ? ' saved' : ''}`} onClick={(e) => handleWordClick(e, token, text)}>
              {token}
            </span>
          ) : (
            <span key={i}>{token}</span>
          ),
        )}
      </span>
    );
  }

  return (
    <div className="subtitle-bar">
      {visibleRemote.length > 0 && (
        <div className="subtitle-remote">
          {remoteLang && <span className="subtitle-lang">{langLabel(remoteLang)}</span>}
          <div className="subtitle-lines">
            {visibleRemote.map((line, i) => (
              <div key={remoteLines.length - visibleRemote.length + i} className="subtitle-line">
                {renderTokenized(line)}
              </div>
            ))}
          </div>
        </div>
      )}
      {visibleLocal.length > 0 && (
        <div className="subtitle-local">
          <div className="subtitle-lines">
            {visibleLocal.map((line, i) => (
              <div key={localLines.length - visibleLocal.length + i} className="subtitle-line">
                {renderTokenized(line)}
              </div>
            ))}
          </div>
        </div>
      )}
      {popup && nativeLang && (
        <WordPopup
          word={popup.word}
          sentence={popup.sentence}
          nativeLang={nativeLang}
          targetLang={remoteLang || undefined}
          anchorRect={popup.rect}
          onClose={() => setPopup(null)}
          isWordSaved={isWordSaved ? isWordSaved(popup.word) : undefined}
          onSaveWord={onSaveWord}
        />
      )}
    </div>
  );
}
