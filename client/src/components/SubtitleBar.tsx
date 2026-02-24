// ---------------------------------------------------------------------------
// components/SubtitleBar.tsx -- Subtitle overlay for call page
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import WordPopup from './WordPopup';

interface SubtitleBarProps {
  localText: string;
  remoteText: string;
  remoteLang: string;
}

function langLabel(lang: string): string {
  if (!lang) return '';
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'language' });
    // Take base language code (e.g. 'en' from 'en-US')
    const base = lang.split('-')[0];
    return display.of(base) ?? lang;
  } catch {
    return lang;
  }
}

function tokenize(text: string): string[] {
  return text.match(/([\p{L}\p{M}\d']+|[.,!?;:]+|\s+)/gu) || [];
}

function isWordToken(token: string): boolean {
  return /^[\p{L}\p{M}\d']+$/u.test(token);
}

interface PopupState {
  word: string;
  sentence: string;
  rect: DOMRect;
}

export default function SubtitleBar({ localText, remoteText, remoteLang }: SubtitleBarProps) {
  const [popup, setPopup] = useState<PopupState | null>(null);

  if (!localText && !remoteText) return null;

  function handleWordClick(e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({ word, sentence, rect });
  }

  function renderTokenized(text: string) {
    return (
      <span className="subtitle-text">
        {tokenize(text).map((token, i) =>
          isWordToken(token) ? (
            <span key={i} className="subtitle-word" onClick={(e) => handleWordClick(e, token, text)}>
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
      {remoteText && (
        <div className="subtitle-remote">
          {remoteLang && <span className="subtitle-lang">{langLabel(remoteLang)}</span>}
          {renderTokenized(remoteText)}
        </div>
      )}
      {localText && (
        <div className="subtitle-local">
          {renderTokenized(localText)}
        </div>
      )}
      {popup && (
        <WordPopup
          word={popup.word}
          sentence={popup.sentence}
          targetLang={remoteLang || undefined}
          anchorRect={popup.rect}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}
