// ---------------------------------------------------------------------------
// components/WordLookupModal.tsx -- Look up words via WiktApi and save them
// ---------------------------------------------------------------------------

import React, { useState, useRef, useEffect } from 'react';
import { wiktLookup, enrichWord } from '../api';
import type { WiktSense } from '../api';
import { useDictionaryToast } from '../hooks/useDictionaryToast';

interface Props {
  targetLang: string;
  nativeLang: string;
  isDefinitionSaved?: (word: string, definition: string) => boolean;
  onSave?: (data: {
    word: string;
    translation: string;
    definition: string;
    target_language: string;
    frequency?: number | null;
    frequency_count?: number | null;
    example_sentence?: string | null;
    part_of_speech?: string | null;
    image_url?: string | null;
    lemma?: string | null;
    forms?: string | null;
  }) => Promise<unknown>;
  onPick?: (sense: WiktSense) => void;
  initialQuery?: string;
  onClose: () => void;
}

export default function WordLookupModal({ targetLang, nativeLang, isDefinitionSaved, onSave, onPick, initialQuery, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [senses, setSenses] = useState<WiktSense[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [savedIdxs, setSavedIdxs] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const { queueSave } = useDictionaryToast();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const doSearch = async (term?: string) => {
    const trimmed = (term ?? query).trim();
    if (!trimmed) return;

    setSearching(true);
    setSearchError('');
    setSenses([]);
    setSearched(false);
    setSavedIdxs(new Set());

    try {
      const result = await wiktLookup(trimmed, targetLang, nativeLang);
      setSenses(result.senses);
      setSearched(true);
      if (!onPick) {
        setSavedIdxs(new Set(
          result.senses.flatMap((s, i) => isDefinitionSaved?.(trimmed, s.gloss) ? [i] : []),
        ));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lookup failed';
      console.error('WiktApi lookup error:', err);
      setSearchError(msg);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (initialQuery?.trim()) doSearch(initialQuery.trim());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSenseClick = (sense: WiktSense, idx: number) => {
    if (onPick) {
      onPick(sense);
      onClose();
      return;
    }
    if (savedIdxs.has(idx)) return;
    setSavedIdxs(prev => new Set(prev).add(idx));

    const word = query.trim();
    queueSave(word, async () => {
      const enriched = await enrichWord(
        word,
        `${word}: ${sense.gloss}`,
        nativeLang,
        targetLang,
      );

      const savedWord = enriched.lemma || word;
      await onSave!({
        word: savedWord,
        definition: sense.gloss,
        part_of_speech: sense.pos || enriched.part_of_speech,
        translation: enriched.translation,
        frequency: enriched.frequency,
        frequency_count: enriched.frequency_count,
        example_sentence: enriched.example_sentence,
        image_url: enriched.image_url,
        target_language: targetLang,
        lemma: enriched.lemma || null,
        forms: enriched.forms || null,
      });
    });
  };

  return (
    <div className="lookup-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lookup-modal">
        <div className="lookup-header">
          <span className="lookup-title">Look up a word</span>
          <button className="word-popup-close" onClick={onClose}>&times;</button>
        </div>

        <div className="lookup-search-row">
          <input
            ref={inputRef}
            type="text"
            className="form-input lookup-input"
            placeholder="Type a word..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => doSearch()}
            disabled={searching || !query.trim()}
          >
            Search
          </button>
        </div>

        <div className="lookup-results">
          {searching && (
            <div className="lookup-center">
              <div className="loading-spinner" />
            </div>
          )}

          {searchError && <p className="lookup-error">{searchError}</p>}

          {!searching && searched && senses.length === 0 && !searchError && (
            <p className="lookup-empty">No definitions found.</p>
          )}

          {senses.length > 0 && (
            <>
            <p className="lookup-count">
              There {senses.length === 1 ? 'is 1 definition' : `are ${senses.length} definitions`} for the word <strong>{query.trim()}</strong>
            </p>
            <div className="lookup-sense-list">
              {senses.map((s, i) => (
                <button
                  key={i}
                  className={`lookup-sense${savedIdxs.has(i) ? ' lookup-sense--saved' : ''}`}
                  onClick={() => handleSenseClick(s, i)}
                  disabled={savedIdxs.has(i)}
                >
                  {savedIdxs.has(i) && <span className="lookup-saved-check">{'\u2713'}</span>}
                  {s.pos && <span className={`dict-pos-badge pos-${s.pos.toLowerCase()}`}>{s.pos}</span>}
                  <span className="lookup-gloss">{s.gloss}</span>
                </button>
              ))}
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
