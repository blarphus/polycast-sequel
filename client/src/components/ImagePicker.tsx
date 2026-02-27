// ---------------------------------------------------------------------------
// components/ImagePicker.tsx -- Modal for searching & picking a word image
// ---------------------------------------------------------------------------

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { searchImages } from '../api';

interface Props {
  initialQuery: string;
  onSelect: (url: string) => Promise<void>;
  onClose: () => void;
}

export default function ImagePicker({ initialQuery, onSelect, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [images, setImages] = useState<string[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [savingUrl, setSavingUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(async (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setSearching(true);
    setImages([]);
    setSearched(false);
    try {
      const result = await searchImages(trimmed);
      setImages(result.images);
      setSearched(true);
    } catch (err) {
      console.error('Image search error:', err);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  }, []);

  // Auto-search on mount
  useEffect(() => {
    doSearch(initialQuery);
  }, [initialQuery, doSearch]);

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

  const handleSelect = async (url: string) => {
    if (savingUrl) return;
    setSavingUrl(url);
    try {
      await onSelect(url);
      onClose();
    } catch (err) {
      console.error('Image select error:', err);
      setSavingUrl(null);
    }
  };

  return (
    <div className="lookup-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lookup-modal imgpicker-modal">
        <div className="lookup-header">
          <span className="lookup-title">Change image</span>
          <button className="word-popup-close" onClick={onClose}>&times;</button>
        </div>

        <div className="lookup-search-row">
          <input
            ref={inputRef}
            type="text"
            className="form-input lookup-input"
            placeholder="Search images..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch(query); }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => doSearch(query)}
            disabled={searching || !query.trim()}
          >
            Search
          </button>
        </div>

        <div className="imgpicker-results">
          {searching && (
            <div className="lookup-center">
              <div className="loading-spinner" />
            </div>
          )}

          {!searching && searched && images.length === 0 && (
            <p className="lookup-empty">No images found.</p>
          )}

          {images.length > 0 && (
            <div className="imgpicker-grid">
              {images.map((url) => (
                <button
                  key={url}
                  className="imgpicker-thumb"
                  onClick={() => handleSelect(url)}
                  disabled={savingUrl !== null}
                >
                  <img src={url} alt="" />
                  {savingUrl === url && (
                    <div className="imgpicker-thumb-spinner">
                      <div className="loading-spinner" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
