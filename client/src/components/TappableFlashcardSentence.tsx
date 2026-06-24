// ---------------------------------------------------------------------------
// components/TappableFlashcardSentence.tsx -- A target-language flashcard
// sentence whose words are clickable to add to the dictionary (same popup as
// the reader / transcript). The card's own target word -- the ~tilde~-marked
// span -- keeps its highlight but is intentionally NOT clickable, because
// re-adding the card's own word causes trouble. Only ever used on the
// target-language sentence, never the native-language translation.
// ---------------------------------------------------------------------------

import React from 'react';
import { tokenize, isWordToken } from '../textTokens';
import { stripTildes, tildeWord } from '../utils/tildeMarkup';

interface Props {
  text: string;                 // may contain ~tildes~ around the target word
  savedWords?: Set<string>;
  onWordClick: (e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) => void;
}

export default function TappableFlashcardSentence({ text, savedWords, onWordClick }: Props) {
  const sentence = stripTildes(text);
  const target = tildeWord(text);
  // Lowercased tokens of the highlighted target word/phrase, so multi-word
  // targets are excluded too.
  const excluded = new Set(
    target ? tokenize(target).filter(isWordToken).map((t) => t.toLowerCase()) : [],
  );

  return (
    <p className="flashcard-sentence">
      {tokenize(sentence).map((token, i) => {
        if (!isWordToken(token)) return <span key={i}>{token}</span>;
        const lower = token.toLowerCase();
        if (excluded.has(lower)) {
          // The card's own target word -- highlighted, not clickable.
          return <span key={i} className="flashcard-highlighted">{token}</span>;
        }
        const isSaved = savedWords?.has(lower);
        return (
          <span
            key={i}
            className={`subtitle-word${isSaved ? ' saved' : ''}`}
            onClick={(e) => onWordClick(e, token, sentence)}
          >
            {token}
          </span>
        );
      })}
    </p>
  );
}
