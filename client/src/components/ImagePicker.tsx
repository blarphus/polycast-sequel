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
  const [customUrl, setCustomUrl] = useState('');
  const [customPreviewError, setCustomPreviewError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<'search' | 'custom'>('search');
  const inputRef = useRef<HTMLInputElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

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
    if (tab === 'search') inputRef.current?.focus();
    else customInputRef.current?.focus();
  }, [tab]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);

    let url = '';

    // 1. Try text/uri-list (standard for dragged URLs)
    url = e.dataTransfer.getData('text/uri-list').trim();

    // 2. Try text/plain
    if (!url) {
      const plain = e.dataTransfer.getData('text/plain').trim();
      if (plain.startsWith('http://') || plain.startsWith('https://')) {
        url = plain;
      }
    }

    // 3. Try text/html — parse out src="..." from <img> tag
    if (!url) {
      const html = e.dataTransfer.getData('text/html');
      if (html) {
        const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match) url = match[1];
      }
    }

    if (url) {
      setCustomUrl(url);
      setCustomPreviewError(false);
      setTab('custom');
    }
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
      <div
        className={`lookup-modal imgpicker-modal${dragging ? ' imgpicker-modal--dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="lookup-header">
          <span className="lookup-title">Change image</span>
          <button className="word-popup-close" onClick={onClose}>&times;</button>
        </div>

        <div className="imgpicker-tabs">
          <button
            className={`imgpicker-tab${tab === 'search' ? ' imgpicker-tab--active' : ''}`}
            onClick={() => setTab('search')}
          >
            Search
          </button>
          <button
            className={`imgpicker-tab${tab === 'custom' ? ' imgpicker-tab--active' : ''}`}
            onClick={() => setTab('custom')}
          >
            Custom URL
          </button>
        </div>

        {tab === 'search' ? (
          <>
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
          </>
        ) : (
          <div className="imgpicker-custom-section">
            <div className="imgpicker-custom-row">
              <input
                ref={customInputRef}
                type="text"
                className="form-input lookup-input"
                placeholder="Paste image URL..."
                value={customUrl}
                onChange={(e) => {
                  setCustomUrl(e.target.value);
                  setCustomPreviewError(false);
                }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleSelect(customUrl)}
                disabled={!customUrl.trim() || customPreviewError || savingUrl !== null}
              >
                Use This Image
              </button>
            </div>

            {customUrl.trim() && (
              <div className="imgpicker-custom-preview-wrap">
                {!customPreviewError ? (
                  <img
                    className="imgpicker-custom-preview"
                    src={customUrl}
                    alt="Preview"
                    onError={() => setCustomPreviewError(true)}
                  />
                ) : (
                  <div className="imgpicker-custom-preview imgpicker-custom-preview-error">
                    Invalid image
                  </div>
                )}
              </div>
            )}

            <div className={`imgpicker-dropzone${dragging ? ' imgpicker-dropzone--active' : ''}`}>
              Drag an image here from another tab
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
