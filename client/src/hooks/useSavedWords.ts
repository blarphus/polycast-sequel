// ---------------------------------------------------------------------------
// hooks/useSavedWords.ts -- Manage personal dictionary words
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback, useMemo } from 'react';
import { getSavedWords, saveWord, deleteSavedWord, SavedWord } from '../api';

export function useSavedWords() {
  const [words, setWords] = useState<SavedWord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getSavedWords()
      .then((data) => {
        if (!cancelled) setWords(data);
      })
      .catch((err) => console.error('Failed to load saved words:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Set of lowercased words for O(1) highlighting lookups
  const savedWordsSet = useMemo(
    () => new Set(words.map((w) => w.word.toLowerCase())),
    [words],
  );

  const isWordSaved = useCallback(
    (word: string) => savedWordsSet.has(word.toLowerCase()),
    [savedWordsSet],
  );

  const isDefinitionSaved = useCallback(
    (word: string, definition: string) =>
      words.some((w) => w.word.toLowerCase() === word.toLowerCase() && w.definition === definition),
    [words],
  );

  const addWord = useCallback(
    async (data: {
      word: string;
      translation: string;
      definition: string;
      target_language?: string;
      sentence_context?: string;
      frequency?: number | null;
      example_sentence?: string | null;
      part_of_speech?: string | null;
    }) => {
      const saved = await saveWord(data);
      setWords((prev) => {
        // Avoid duplicates
        if (prev.some((w) => w.id === saved.id)) return prev;
        return [saved, ...prev];
      });
      return saved;
    },
    [],
  );

  const removeWord = useCallback(async (id: string) => {
    await deleteSavedWord(id);
    setWords((prev) => prev.filter((w) => w.id !== id));
  }, []);

  return { words, loading, savedWordsSet, isWordSaved, isDefinitionSaved, addWord, removeWord };
}
