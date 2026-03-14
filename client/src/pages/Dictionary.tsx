// ---------------------------------------------------------------------------
// pages/Dictionary.tsx -- Personal dictionary with collapsible entries
// ---------------------------------------------------------------------------

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import { getDueStatus, formatDuration } from '../utils/srs';
import { formatDate } from '../utils/dateFormat';
import { renderTildeHighlight } from '../utils/tildeMarkup';
import { buildDictionaryGroups, getDueNextGroupKeys, type DictionarySortMode } from '../utils/dictionaryGroups';
import WordLookupModal from '../components/WordLookupModal';
import ImagePicker from '../components/ImagePicker';
import { proxyImageUrl } from '../api';
import type { SavedWord } from '../api';
import { SearchIcon, SearchMinusIcon, BookPlusIcon, ChevronDownIcon, TrashIcon, GripVerticalIcon } from '../components/icons';
import { FrequencyDots, FREQUENCY_DOT_COLORS } from '../components/FrequencyDots';

// -- DueStatusBadge: shows SRS status in collapsed header -------------------

function DueStatusBadge({ word }: { word: SavedWord }) {
  const status = getDueStatus(word);
  return (
    <span className={`dict-due-badge dict-due-badge--${status.urgency}`}>
      {status.label}
    </span>
  );
}

// -- Review field for expanded view -----------------------------------------

function ReviewField({ word }: { word: SavedWord }) {
  const isNew = word.srs_interval === 0 && word.learning_step === null && !word.last_reviewed_at;
  const inLearning = word.learning_step !== null;

  if (isNew) {
    return (
      <div className="dict-field">
        <span className="dict-field-label">Review</span>
        <span className="dict-field-value text-muted">Not yet reviewed</span>
      </div>
    );
  }

  if (inLearning) {
    return (
      <div className="dict-field">
        <span className="dict-field-label">Review</span>
        <span className="dict-field-value text-muted">Learning</span>
      </div>
    );
  }

  // Graduated review card
  const status = getDueStatus(word);
  const easePercent = Math.round(word.ease_factor * 100);
  const intervalLabel = formatDuration(word.srs_interval);

  return (
    <div className="dict-field">
      <span className="dict-field-label">Review</span>
      <span className="dict-field-value text-muted">
        {status.label} &middot; Ease: {easePercent}% &middot; Interval: {intervalLabel}
      </span>
    </div>
  );
}

function buildQueueTintStyles(
  hue: number,
  intensity: number,
  darkness: number,
  shadowStrength: number,
  shadowSize: number,
) {
  const alpha = 0.03 + (intensity / 100) * 0.2;
  const headerAlpha = alpha * 0.72;
  const hoverAlpha = alpha * 1.35;
  const borderAlpha = 0.06 + (intensity / 100) * 0.18;
  const shadowAlpha = 0.08 + (shadowStrength / 100) * 0.34;
  const baseLightness = 92 - (darkness / 100) * 44;
  const borderLightness = Math.max(24, baseLightness - 18);
  const shadowLightness = Math.max(14, baseLightness - 40 - (shadowStrength / 100) * 8);
  const shadowBlur = 10 + (shadowSize / 100) * 34;
  const shadowSpread = -14 + (shadowSize / 100) * 10;
  const shadowOffsetY = 6 + (shadowSize / 100) * 16;

  return {
    '--queue-tint': `hsla(${hue} 88% ${baseLightness}% / ${alpha.toFixed(3)})`,
    '--queue-tint-header': `hsla(${hue} 88% ${baseLightness}% / ${headerAlpha.toFixed(3)})`,
    '--queue-tint-hover': `hsla(${hue} 88% ${baseLightness}% / ${hoverAlpha.toFixed(3)})`,
    '--queue-tint-border': `hsla(${hue} 78% ${borderLightness}% / ${borderAlpha.toFixed(3)})`,
    '--queue-tint-shadow': `hsla(${hue} 78% ${shadowLightness}% / ${shadowAlpha.toFixed(3)})`,
    '--queue-shadow-y': `${shadowOffsetY.toFixed(1)}px`,
    '--queue-shadow-blur': `${shadowBlur.toFixed(1)}px`,
    '--queue-shadow-spread': `${shadowSpread.toFixed(1)}px`,
  } as React.CSSProperties;
}

const QUEUE_TINT_STYLES = buildQueueTintStyles(220, 38, 29, 35, 44);

export default function Dictionary() {
  const { user } = useAuth();
  const { words, loading, removeWord, addWord, updateImage, isDefinitionSaved, reorderQueueWords } = useSavedWords();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<DictionarySortMode>('queue');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [imagePickerWord, setImagePickerWord] = useState<SavedWord | null>(null);
  const [page, setPage] = useState(0);
  const WORDS_PER_PAGE = 20;

  // DnD state
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Bracket height measurement
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [bracketHeight, setBracketHeight] = useState(0);

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const wordGroups = useMemo(() => {
    return buildDictionaryGroups(words, search, sort);
  }, [words, search, sort]);

  const dailyNewLimit = user?.daily_new_limit ?? 5;
  const dueNextGroupKeys = useMemo(
    () => getDueNextGroupKeys(wordGroups, dailyNewLimit),
    [dailyNewLimit, wordGroups],
  );

  const totalPages = Math.ceil(wordGroups.length / WORDS_PER_PAGE);
  const pageGroups = wordGroups.slice(page * WORDS_PER_PAGE, (page + 1) * WORDS_PER_PAGE);
  const dueNextPageKeys = useMemo(
    () => (sort === 'queue' && page === 0
      ? pageGroups.filter((group) => dueNextGroupKeys.has(group.key)).map((group) => group.key)
      : []),
    [dueNextGroupKeys, page, pageGroups, sort],
  );

  // Measure bracket height after render
  useEffect(() => {
    if (dueNextPageKeys.length === 0) { setBracketHeight(0); return; }
    let height = 0;
    for (let i = 0; i < dueNextPageKeys.length; i++) {
      const el = itemRefs.current.get(dueNextPageKeys[i]);
      if (el) {
        height += el.offsetHeight;
        if (i < dueNextPageKeys.length - 1) height += 8; // gap (0.5rem)
      }
    }
    setBracketHeight(height);
  }, [dueNextPageKeys, expandedKeys]);

  const setItemRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) itemRefs.current.set(key, el);
    else itemRefs.current.delete(key);
  }, []);

  // DnD handlers
  const handleDragStart = (e: React.DragEvent, groupKey: string) => {
    setDragItem(groupKey);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, groupKey: string) => {
    e.preventDefault();
    if (dragItem && dragItem !== groupKey) setDragOverId(groupKey);
  };

  const handleDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (!dragItem || dragItem === targetKey) {
      setDragItem(null);
      setDragOverId(null);
      return;
    }

    // Only reorder among new-card groups on the current page
    const newGroups = wordGroups.filter((group) => group.hasNew);
    const dragIndex = newGroups.findIndex((g) => g.key === dragItem);
    const targetIndex = newGroups.findIndex((g) => g.key === targetKey);
    if (dragIndex === -1 || targetIndex === -1) {
      setDragItem(null);
      setDragOverId(null);
      return;
    }

    const reordered = [...newGroups];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    // Build position updates for all entries in reordered new-card groups
    const items: Array<{ id: string; queue_position: number }> = [];
    reordered.forEach((g, gi) => {
      for (const entry of g.entries) {
        items.push({ id: entry.id, queue_position: gi });
      }
    });

    reorderQueueWords(items);
    setDragItem(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDragItem(null);
    setDragOverId(null);
  };

  const isQueueMode = sort === 'queue';

  return (
    <div className="dict-page" style={QUEUE_TINT_STYLES}>
      <main className="dict-main">
        <section className="home-section">
          <h2 className="section-title">My Dictionary</h2>

          {/* Controls row */}
          <div className="dict-controls">
            <div className="dict-search-wrapper">
              <SearchIcon size={16} className="dict-search-icon" />
              <input
                type="text"
                className="form-input dict-search"
                placeholder="Search words..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
            <select
              className="form-input dict-sort"
              value={sort}
              onChange={(e) => { setSort(e.target.value as DictionarySortMode); setPage(0); }}
            >
              <option value="queue">Queue</option>
              <option value="date">Recent first</option>
              <option value="az">A-Z</option>
              <option value="freq-high">Frequency high &rarr; low</option>
              <option value="freq-low">Frequency low &rarr; high</option>
              <option value="due">Due soonest</option>
            </select>
            <span className="dict-count">{wordGroups.length} word{wordGroups.length !== 1 ? 's' : ''}</span>
            {user?.native_language && user?.target_language && (
              <button className="dict-lookup-btn" onClick={() => setLookupOpen(true)} title="Look up a word">+</button>
            )}
          </div>

          {loading ? (
            <p className="text-muted">Loading saved words...</p>
          ) : wordGroups.length === 0 ? (
            <div className="dict-empty">
              {search ? (
                <>
                  <div className="dict-empty-icon">
                    <SearchMinusIcon size={40} strokeWidth={1.5} />
                  </div>
                  <p>No words match your search.</p>
                </>
              ) : (
                <>
                  <div className="dict-empty-icon">
                    <BookPlusIcon size={40} strokeWidth={1.5} />
                  </div>
                  <p>No saved words yet. Click on words in subtitles and press + to save them.</p>
                </>
              )}
            </div>
          ) : (
            <div className="dict-container">
              <div className={`dict-list${isQueueMode ? ' dict-list--queue-view' : ''}`}>
                {/* Bracket rail */}
                {isQueueMode && page === 0 && dueNextPageKeys.length > 0 && bracketHeight > 0 && (
                  <div className="dict-queue-bracket" style={{ height: bracketHeight }}>
                    <span className="dict-queue-bracket-label">DUE NEXT</span>
                  </div>
                )}
                {pageGroups.map((group) => {
                  const open = expandedKeys.has(group.key);
                  const maxFreq = group.maxFrequency;
                  const freqColor = maxFreq != null ? FREQUENCY_DOT_COLORS[Math.ceil(maxFreq / 2) - 1] || FREQUENCY_DOT_COLORS[0] : undefined;
                  const inBracket = isQueueMode && page === 0 && dueNextGroupKeys.has(group.key);
                  const isDraggable = isQueueMode && group.hasNew;
                  const isDragOver = dragOverId === group.key;
                  return (
                    <div
                      key={group.key}
                      ref={(el) => setItemRef(group.key, el)}
                      className={
                        `dict-item${open ? ' open' : ''}` +
                        `${inBracket ? ' dict-item--in-bracket' : ''}` +
                        `${isDragOver ? ' dict-item--drag-over' : ''}`
                      }
                      style={freqColor ? { borderLeftColor: freqColor } : undefined}
                      draggable={isDraggable}
                      onDragStart={isDraggable ? (e) => handleDragStart(e, group.key) : undefined}
                      onDragOver={isDraggable ? (e) => handleDragOver(e, group.key) : undefined}
                      onDrop={isDraggable ? (e) => handleDrop(e, group.key) : undefined}
                      onDragEnd={isDraggable ? handleDragEnd : undefined}
                    >
                      <button className="dict-item-header" onClick={() => toggle(group.key)}>
                        {isDraggable && (
                          <span
                            className="dict-drag-handle"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <GripVerticalIcon size={16} />
                          </span>
                        )}
                        <span className="dict-word">{group.word}</span>
                        <FrequencyDots frequency={maxFreq} />
                        {maxFreq != null && <span className="dict-freq-number">{maxFreq}/10</span>}
                        {group.primaryEntry.part_of_speech && (
                          <span className={`dict-pos-badge pos-${group.primaryEntry.part_of_speech.toLowerCase()}`}>{group.primaryEntry.part_of_speech}</span>
                        )}
                        {group.hasPriority && (
                          <span className="assigned-badge">Assigned</span>
                        )}
                        {group.entries.length > 1 && (
                          <span className="dict-def-count">{group.entries.length}</span>
                        )}
                        <DueStatusBadge word={group.primaryEntry} />
                        <ChevronDownIcon size={18} className="dict-chevron" />
                      </button>
                      {open && (
                        <div className="dict-item-body">
                          {group.entries.map((w) => (
                            <div key={w.id} className="dict-definition-card">
                              <div className="dict-def-layout">
                                <div className="dict-def-info">
                                  {w.part_of_speech && (
                                    <span className={`dict-pos-badge pos-${w.part_of_speech.toLowerCase()}`}>{w.part_of_speech}</span>
                                  )}
                                  <div className="dict-field">
                                    <span className="dict-field-label">Translation</span>
                                    <span className="dict-field-value">{w.translation}</span>
                                  </div>
                                  {w.definition && (
                                    <div className="dict-field">
                                      <span className="dict-field-label">Definition</span>
                                      <span className="dict-field-value">{w.definition}</span>
                                    </div>
                                  )}
                                  {w.forms && (() => {
                                    try {
                                      const fl: string[] = JSON.parse(w.forms);
                                      return (
                                        <div className="dict-field">
                                          <span className="dict-field-label">Forms</span>
                                          <span className="dict-field-value text-muted">{fl.join(', ')}</span>
                                        </div>
                                      );
                                    } catch { return null; }
                                  })()}
                                  {w.example_sentence && (
                                    <div className="dict-field">
                                      <span className="dict-field-label">Example</span>
                                      <span className="dict-field-value dict-example">
                                        {renderTildeHighlight(w.example_sentence, 'dict-highlight')}
                                      </span>
                                    </div>
                                  )}
                                  <div className="dict-field">
                                    <span className="dict-field-label">Saved</span>
                                    <span className="dict-field-value text-muted">{formatDate(w.created_at)}</span>
                                  </div>
                                  <ReviewField word={w} />
                                  {w.frequency_count != null && (
                                    <div className="dict-field">
                                      <span className="dict-field-label">Corpus count</span>
                                      <span className="dict-field-value text-muted">
                                        {w.frequency_count.toLocaleString()}
                                      </span>
                                    </div>
                                  )}
                                  <button className="dict-remove-btn" onClick={() => removeWord(w.id)}>
                                    <TrashIcon size={16} />
                                    Remove
                                  </button>
                                </div>
                                <div className="dict-image-block">
                                  {w.image_url ? (
                                    <>
                                      <img
                                        className="dict-def-image dict-word-image--clickable"
                                        src={proxyImageUrl(w.image_url)!}
                                        alt={w.word}
                                        loading="lazy"
                                        onClick={() => setLightboxUrl(w.image_url!)}
                                      />
                                      <button className="dict-change-image-btn" onClick={() => setImagePickerWord(w)}>
                                        Change image
                                      </button>
                                    </>
                                  ) : (
                                    <button className="dict-add-image-btn" onClick={() => setImagePickerWord(w)}>
                                      + Add image
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {totalPages > 1 && (
                <div className="dict-pagination">
                  <button
                    className="dict-page-btn"
                    onClick={() => setPage((p) => p - 1)}
                    disabled={page === 0}
                  >
                    &larr; Previous
                  </button>
                  <span className="dict-page-info">
                    Page {page + 1} of {totalPages}
                  </span>
                  <button
                    className="dict-page-btn"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= totalPages - 1}
                  >
                    Next &rarr;
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {lightboxUrl && (
        <div className="dict-lightbox" onClick={() => setLightboxUrl(null)}>
          <img src={proxyImageUrl(lightboxUrl)!} alt="Enlarged" />
        </div>
      )}

      {imagePickerWord && (
        <ImagePicker
          initialQuery={imagePickerWord.image_term || imagePickerWord.translation || imagePickerWord.word}
          onSelect={async (url) => { await updateImage(imagePickerWord.id, url); }}
          onClose={() => setImagePickerWord(null)}
        />
      )}

      {lookupOpen && user?.native_language && user?.target_language && (
        <WordLookupModal
          targetLang={user.target_language}
          nativeLang={user.native_language}
          isDefinitionSaved={isDefinitionSaved}
          onSave={addWord}
          onClose={() => setLookupOpen(false)}
        />
      )}
    </div>
  );
}
