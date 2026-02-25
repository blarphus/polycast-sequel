// ---------------------------------------------------------------------------
// components/TokenizedText.tsx -- Shared tokenized word rendering
// ---------------------------------------------------------------------------

import React from 'react';
import { tokenize, isWordToken } from '../textTokens';

interface TokenizedTextProps {
  text: string;
  savedWords?: Set<string>;
  onWordClick: (e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) => void;
}

export default function TokenizedText({ text, savedWords, onWordClick }: TokenizedTextProps) {
  return (
    <>
      {tokenize(text).map((token, i) =>
        isWordToken(token) ? (
          <span
            key={i}
            className={`subtitle-word${savedWords?.has(token.toLowerCase()) ? ' saved' : ''}`}
            onClick={(e) => onWordClick(e, token, text)}
          >
            {token}
          </span>
        ) : (
          <span key={i}>{token}</span>
        ),
      )}
    </>
  );
}
