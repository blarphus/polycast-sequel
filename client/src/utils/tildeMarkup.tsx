// ---------------------------------------------------------------------------
// utils/tildeMarkup.tsx -- Shared ~word~ markup parsing helpers
// ---------------------------------------------------------------------------

import React from 'react';

/** Parse ~word~ markup into JSX with highlighted spans using the given class. */
export function renderTildeHighlight(text: string, className: string) {
  const parts = text.split(/~([^~]+)~/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className={className}>{part}</span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** Replace ~word~ with _____ for the cloze front. */
export function renderCloze(text: string) {
  const parts = text.split(/~([^~]+)~/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="flashcard-cloze">_____</span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** Strip ~tildes~ from example sentence for TTS playback. */
export function stripTildes(text: string): string {
  return text.replace(/~([^~]+)~/g, '$1');
}
