// ---------------------------------------------------------------------------
// hooks/useSavedWords.ts -- Manage personal dictionary words
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback, useMemo } from 'react';
import { getSavedWords, saveWord, deleteSavedWord, updateWordImage, reorderQueue, SavedWord } from '../api';
import { toErrorMessage } from '../utils/errors';

function parseWordForms(rawForms: string | null | undefined, word: string) {
  if (!rawForms) return [];
  const parsed = JSON.parse(rawForms);
  if (!Array.isArray(parsed)) {
    throw new Error(`Saved forms payload for "${word}" is not an array`);
  }
  return parsed.filter((value): value is string => typeof value === 'string');
}

export function useSavedWords() {
  const [words, setWords] = useState<SavedWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [optimisticWords, setOptimisticWords] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getSavedWords()
      .then((data) => {
        if (!cancelled) setWords(data);
      })
      .catch((err) => {
        console.error('Failed to load saved words:', err);
        if (!cancelled) setError(toErrorMessage(err));
      })
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
        const formsList = parseWordForms(w.forms, w.word);
        for (const form of formsList) set.add(form.toLowerCase());
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
          const fl = parseWordForms(w.forms, w.word);
          if (fl.some(f => f.toLowerCase() === word.toLowerCase())) return true;
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
          const fl = parseWordForms(data.forms, data.word);
          for (const f of fl) next.add(f.toLowerCase());
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
    async (items: Array<{ id: string; queue_position: number }>) => {
      const previousWords = words;
      // Optimistic: update local state immediately
      setWords((prev) =>
        prev.map((w) => {
          const match = items.find((i) => i.id === w.id);
          return match ? { ...w, queue_position: match.queue_position } : w;
        }),
      );
      setError('');
      try {
        await reorderQueue(items);
      } catch (err) {
        console.error('Queue reorder failed:', err);
        setWords(previousWords);
        setError(toErrorMessage(err));
      }
    },
    [words],
  );

  const addOptimistic = useCallback((word: string, forms?: string | null) => {
    setOptimisticWords((prev) => {
      const next = new Set(prev);
      next.add(word.toLowerCase());
      if (forms) {
        const fl = parseWordForms(forms, word);
        for (const f of fl) next.add(f.toLowerCase());
      }
      return next;
    });
  }, []);

  return { words, loading, error, savedWordsSet, isWordSaved, isDefinitionSaved, addWord, addOptimistic, removeWord, updateImage, reorderQueueWords };
}
