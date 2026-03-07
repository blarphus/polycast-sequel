// ---------------------------------------------------------------------------
// components/TokenizedText.tsx -- Shared tokenized word rendering
// ---------------------------------------------------------------------------

import React from 'react';
import { tokenize, isWordToken } from '../textTokens';

export interface WordHint {
  imageUrl: string | null;
}

interface TokenizedTextProps {
  text: string;
  savedWords?: Set<string>;
  wordHints?: Map<string, WordHint>;
  onWordClick: (e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) => void;
}

export default function TokenizedText({ text, savedWords, wordHints, onWordClick }: TokenizedTextProps) {
  return (
    <>
      {tokenize(text).map((token, i) => {
        if (!isWordToken(token)) return <span key={i}>{token}</span>;

        const hint = wordHints?.get(token.toLowerCase());
        const isSaved = savedWords?.has(token.toLowerCase());

        return (
          <span
            key={i}
            className={`subtitle-word${isSaved ? ' saved' : ''}${hint ? ' has-hint' : ''}`}
            onClick={(e) => onWordClick(e, token, text)}
          >
            {token}
            {hint?.imageUrl && (
              <img
                className="subtitle-word-hint-img"
                src={hint.imageUrl}
                alt=""
                aria-hidden="true"
              />
            )}
          </span>
        );
      })}
    </>
  );
}
