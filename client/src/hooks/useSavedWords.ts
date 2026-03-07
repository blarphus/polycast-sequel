// ---------------------------------------------------------------------------
// hooks/useSavedWords.ts -- Manage personal dictionary words
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback, useMemo } from 'react';
import { getSavedWords, saveWord, deleteSavedWord, updateWordImage, reorderQueue, SavedWord } from '../api';

export function useSavedWords() {
  const [words, setWords] = useState<SavedWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimisticWords, setOptimisticWords] = useState<Set<string>>(new Set());

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

  // Set of lowercased words for O(1) highlighting lookups (includes all inflected forms + optimistic)
  const savedWordsSet = useMemo(() => {
    const set = new Set<string>(optimisticWords);
    for (const w of words) {
      set.add(w.word.toLowerCase());
      if (w.forms) {
        try {
          const formsList: string[] = JSON.parse(w.forms);
          for (const form of formsList) set.add(form.toLowerCase());
        } catch (err) {
          console.error('Failed to parse forms for word:', w.word, err);
        }
      }
    }
    return set;
  }, [words, optimisticWords]);

  const isWordSaved = useCallback(
    (word: string) => savedWordsSet.has(word.toLowerCase()),
    [savedWordsSet],
  );

  const isDefinitionSaved = useCallback(
    (word: string, definition: string) =>
      words.some((w) => {
        if (w.definition !== definition) return false;
        if (w.word.toLowerCase() === word.toLowerCase()) return true;
        if (w.forms) {
          try {
            const fl: string[] = JSON.parse(w.forms);
            if (fl.some(f => f.toLowerCase() === word.toLowerCase())) return true;
          } catch { /* skip malformed */ }
        }
        return false;
      }),
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
      frequency_count?: number | null;
      example_sentence?: string | null;
      part_of_speech?: string | null;
      image_url?: string | null;
      lemma?: string | null;
      forms?: string | null;
    }) => {
      // Optimistically add word (and its forms) so it turns blue instantly
      setOptimisticWords((prev) => {
        const next = new Set(prev);
        next.add(data.word.toLowerCase());
        if (data.forms) {
          try {
            const fl: string[] = JSON.parse(data.forms);
            for (const f of fl) next.add(f.toLowerCase());
          } catch { /* skip malformed */ }
        }
        return next;
      });

      const saved = await saveWord(data);
      if (saved._created) {
        setWords((prev) => {
          if (prev.some((w) => w.id === saved.id)) return prev;
          return [saved, ...prev];
        });
      }
      return saved;
    },
    [],
  );

  const removeWord = useCallback(async (id: string) => {
    await deleteSavedWord(id);
    setWords((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const updateImage = useCallback(async (id: string, imageUrl: string) => {
    const updated = await updateWordImage(id, imageUrl);
    setWords((prev) => prev.map((w) => (w.id === id ? updated : w)));
    return updated;
  }, []);

  const reorderQueueWords = useCallback(
    (items: Array<{ id: string; queue_position: number }>) => {
      // Optimistic: update local state immediately
      setWords((prev) =>
        prev.map((w) => {
          const match = items.find((i) => i.id === w.id);
          return match ? { ...w, queue_position: match.queue_position } : w;
        }),
      );
      // Persist to backend; re-fetch on failure
      reorderQueue(items).catch((err) => {
        console.error('Queue reorder failed:', err);
        getSavedWords().then(setWords).catch((e) => console.error('Re-fetch after reorder failure:', e));
      });
    },
    [],
  );

  return { words, loading, savedWordsSet, isWordSaved, isDefinitionSaved, addWord, removeWord, updateImage, reorderQueueWords };
}
