// ---------------------------------------------------------------------------
// hooks/useTranscriptEntries.ts -- Manages transcript entries + auto-translate
// ---------------------------------------------------------------------------

import { useState, useRef, useCallback } from 'react';
import { TranscriptEntry } from '../components/TranscriptPanel';
import { translateSentence } from '../api';

export function useTranscriptEntries(nativeLang: string | null | undefined) {
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);
  const entryIdRef = useRef(0);

  const onTranscriptEntry = useCallback(
    (data: { userId: string; displayName: string; text: string; lang?: string }) => {
      const id = ++entryIdRef.current;
      const entry: TranscriptEntry = { ...data, id };
      setTranscriptEntries(prev => [...prev, entry]);

      if (nativeLang) {
        translateSentence(data.text, '', nativeLang)
          .then(({ translation, detectedSourceLang }) => {
            const keepTranslation = !!translation && translation.toLowerCase() !== data.text.toLowerCase();
            setTranscriptEntries(prev =>
              prev.map(e => e.id === id
                ? {
                  ...e,
                  ...(keepTranslation ? { translation } : {}),
                  // Google's detection labels the line; the transcriber reports
                  // no language and previously left a hardcoded "en" everywhere.
                  ...(detectedSourceLang ? { lang: detectedSourceLang } : {}),
                }
                : e),
            );
          })
          .catch((err) => console.error('Failed to translate transcript entry:', err));
      }
    },
    [nativeLang],
  );

  return { transcriptEntries, onTranscriptEntry };
}
