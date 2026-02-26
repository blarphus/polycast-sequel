// ---------------------------------------------------------------------------
// components/WordLookupModal.tsx -- Look up words via WiktApi and save them
// ---------------------------------------------------------------------------

import React, { useState, useRef, useEffect } from 'react';
import { wiktLookup, enrichWord } from '../api';
import type { WiktSense } from '../api';

interface Props {
  targetLang: string;
  nativeLang: string;
  onSave: (data: {
    word: string;
    translation: string;
    definition: string;
    target_language: string;
    frequency?: number | null;
    example_sentence?: string | null;
    part_of_speech?: string | null;
    image_url?: string | null;
  }) => Promise<unknown>;
  onClose: () => void;
}

export default function WordLookupModal({ targetLang, nativeLang, onSave, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [senses, setSenses] = useState<WiktSense[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const doSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setSearching(true);
    setSearchError('');
    setSenses([]);
    setSearched(false);

    try {
      const result = await wiktLookup(trimmed, targetLang, nativeLang);
      setSenses(result.senses);
      setSearched(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lookup failed';
      console.error('WiktApi lookup error:', err);
      setSearchError(msg);
    } finally {
      setSearching(false);
    }
  };

  const handleSenseClick = async (sense: WiktSense, idx: number) => {
    if (savingIdx !== null) return;
    setSavingIdx(idx);

    const word = query.trim();

    try {
      const enriched = await enrichWord(
        word,
        `${word}: ${sense.gloss}`,
        nativeLang,
        targetLang,
      );

      await onSave({
        word,
        definition: sense.gloss,
        part_of_speech: sense.pos || enriched.part_of_speech,
        translation: enriched.translation,
        frequency: enriched.frequency,
        example_sentence: enriched.example_sentence,
        image_url: enriched.image_url,
        target_language: targetLang,
      });

      onClose();
    } catch (err: unknown) {
      console.error('Enrich/save error:', err);
      setSavingIdx(null);
    }
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
            onClick={doSearch}
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
                  className="lookup-sense"
                  onClick={() => handleSenseClick(s, i)}
                  disabled={savingIdx !== null}
                >
                  {savingIdx === i ? (
                    <div className="loading-spinner" style={{ width: 20, height: 20 }} />
                  ) : (
                    <>
                      {s.pos && <span className="dict-pos-badge">{s.pos}</span>}
                      <span className="lookup-gloss">{s.gloss}</span>
                    </>
                  )}
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
