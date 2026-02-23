// ---------------------------------------------------------------------------
// components/SubtitleBar.tsx -- Subtitle overlay for call page
// ---------------------------------------------------------------------------

import React from 'react';

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

export default function SubtitleBar({ localText, remoteText, remoteLang }: SubtitleBarProps) {
  if (!localText && !remoteText) return null;

  return (
    <div className="subtitle-bar">
      {remoteText && (
        <div className="subtitle-remote">
          {remoteLang && <span className="subtitle-lang">{langLabel(remoteLang)}</span>}
          <span className="subtitle-text">{remoteText}</span>
        </div>
      )}
      {localText && (
        <div className="subtitle-local">
          <span className="subtitle-text">{localText}</span>
        </div>
      )}
    </div>
  );
}
