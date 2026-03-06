// ---------------------------------------------------------------------------
// pages/Dictionary.tsx -- Personal dictionary with collapsible entries
// ---------------------------------------------------------------------------

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import { getDueStatus, formatDuration } from '../utils/srs';
import { formatDate } from '../utils/dateFormat';
import { renderTildeHighlight } from '../utils/tildeMarkup';
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

// -- Helpers ----------------------------------------------------------------

function isEntryNew(e: SavedWord): boolean {
  return e.srs_interval === 0 && e.learning_step === null && !e.last_reviewed_at;
}

function isGroupNew(group: WordGroup): boolean {
  return group.entries.some(isEntryNew);
}

// -- Sort options -----------------------------------------------------------

type SortMode = 'queue' | 'date' | 'az' | 'freq-high' | 'freq-low' | 'due';

interface WordGroup {
  key: string;
  word: string;
  target_language: string | null;
  entries: SavedWord[];
}

export default function Dictionary() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { words, loading, removeWord, addWord, updateImage, isDefinitionSaved, reorderQueueWords } = useSavedWords();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('queue');
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
    const q = search.toLowerCase().trim();
    let list = words;
    if (q) {
      list = list.filter(
        (w) =>
          w.word.toLowerCase().includes(q) ||
          w.translation.toLowerCase().includes(q),
      );
    }

    // Group by (word, target_language)
    const groupMap = new Map<string, WordGroup>();
    for (const w of list) {
      const key = w.word + '|' + (w.target_language || '');
      let group = groupMap.get(key);
      if (!group) {
        group = { key, word: w.word, target_language: w.target_language, entries: [] };
        groupMap.set(key, group);
      }
      group.entries.push(w);
    }

    const groups = Array.from(groupMap.values());

    switch (sort) {
      case 'queue': {
        groups.sort((a, b) => {
          const aNew = isGroupNew(a);
          const bNew = isGroupNew(b);
          // New cards first
          if (aNew && !bNew) return -1;
          if (!aNew && bNew) return 1;

          if (aNew && bNew) {
            // queue_position ASC (null last)
            const aPos = Math.min(...a.entries.map((e) => e.queue_position ?? Infinity));
            const bPos = Math.min(...b.entries.map((e) => e.queue_position ?? Infinity));
            if (aPos !== bPos) return aPos - bPos;
            // priority DESC
            const aPri = a.entries.some((e) => e.priority) ? 1 : 0;
            const bPri = b.entries.some((e) => e.priority) ? 1 : 0;
            if (aPri !== bPri) return bPri - aPri;
            // frequency DESC
            const aFreq = Math.max(...a.entries.map((e) => e.frequency ?? 0));
            const bFreq = Math.max(...b.entries.map((e) => e.frequency ?? 0));
            if (aFreq !== bFreq) return bFreq - aFreq;
            // created_at ASC
            const aTime = Math.min(...a.entries.map((e) => new Date(e.created_at).getTime()));
            const bTime = Math.min(...b.entries.map((e) => new Date(e.created_at).getTime()));
            return aTime - bTime;
          }

          // Both reviewed: due_at ASC
          const aEarliest = Math.min(...a.entries.map((e) => e.due_at ? new Date(e.due_at).getTime() : Infinity));
          const bEarliest = Math.min(...b.entries.map((e) => e.due_at ? new Date(e.due_at).getTime() : Infinity));
          return aEarliest - bEarliest;
        });
        break;
      }
      case 'az':
        groups.sort((a, b) => a.word.localeCompare(b.word));
        break;
      case 'freq-high':
      case 'freq-low': {
        const maxFreq = (g: WordGroup) => Math.max(...g.entries.map((e) => e.frequency ?? 0));
        if (sort === 'freq-high') {
          groups.sort((a, b) => maxFreq(b) - maxFreq(a));
        } else {
          groups.sort((a, b) => maxFreq(a) - maxFreq(b));
        }
        break;
      }
      case 'due':
        groups.sort((a, b) => {
          const earliest = (g: WordGroup) => {
            const dues = g.entries.map((e) => e.due_at);
            const nonNull = dues.filter(Boolean) as string[];
            if (nonNull.length === 0) return -Infinity; // new cards first
            return Math.min(...nonNull.map((d) => new Date(d).getTime()));
          };
          return earliest(a) - earliest(b);
        });
        break;
      default: {
        // date: most recent entry in group
        const mostRecent = (g: WordGroup) =>
          Math.max(...g.entries.map((e) => new Date(e.created_at).getTime()));
        groups.sort((a, b) => mostRecent(b) - mostRecent(a));
        break;
      }
    }
    return groups;
  }, [words, search, sort]);

  // Bracket computation
  const dailyNewLimit = user?.daily_new_limit ?? 5;
  const bracketCount = useMemo(() => {
    if (sort !== 'queue' || page !== 0) return 0;
    let count = 0;
    for (const g of wordGroups) {
      if (isGroupNew(g)) count++;
      else break;
    }
    return Math.min(dailyNewLimit, count);
  }, [wordGroups, sort, page, dailyNewLimit]);

  const totalPages = Math.ceil(wordGroups.length / WORDS_PER_PAGE);
  const pageGroups = wordGroups.slice(page * WORDS_PER_PAGE, (page + 1) * WORDS_PER_PAGE);

  // Measure bracket height after render
  useEffect(() => {
    if (bracketCount === 0) { setBracketHeight(0); return; }
    let height = 0;
    const keys = pageGroups.slice(0, bracketCount).map((g) => g.key);
    for (let i = 0; i < keys.length; i++) {
      const el = itemRefs.current.get(keys[i]);
      if (el) {
        height += el.offsetHeight;
        if (i < keys.length - 1) height += 8; // gap (0.5rem)
      }
    }
    setBracketHeight(height);
  }, [bracketCount, pageGroups, expandedKeys]);

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
    const newGroups = pageGroups.filter(isGroupNew);
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

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const isQueueMode = sort === 'queue';

  return (
    <div className="dict-page">
      <header className="home-header">
        <div className="home-header-left">
          <h1 className="home-logo">Polycast</h1>
        </div>
        <div className="home-header-right">
          <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
            Settings
          </button>
          <button className="btn btn-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

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
              onChange={(e) => { setSort(e.target.value as SortMode); setPage(0); }}
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
                {isQueueMode && page === 0 && bracketCount > 0 && bracketHeight > 0 && (
                  <div className="dict-queue-bracket" style={{ height: bracketHeight }}>
                    <span className="dict-queue-bracket-label">DUE NEXT</span>
                  </div>
                )}
                {pageGroups.map((group, groupIndex) => {
                  const open = expandedKeys.has(group.key);
                  const maxFreq = Math.max(...group.entries.map((e) => e.frequency ?? 0)) || null;
                  const freqColor = maxFreq != null ? FREQUENCY_DOT_COLORS[Math.ceil(maxFreq / 2) - 1] || FREQUENCY_DOT_COLORS[0] : undefined;
                  const groupIsNew = isGroupNew(group);
                  const inBracket = isQueueMode && page === 0 && groupIndex < bracketCount;
                  const isDraggable = isQueueMode && groupIsNew;
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
                        {group.entries[0].part_of_speech && (
                          <span className={`dict-pos-badge pos-${group.entries[0].part_of_speech.toLowerCase()}`}>{group.entries[0].part_of_speech}</span>
                        )}
                        {group.entries.some((e) => e.priority) && (
                          <span className="assigned-badge">Assigned</span>
                        )}
                        {group.entries.length > 1 && (
                          <span className="dict-def-count">{group.entries.length}</span>
                        )}
                        <DueStatusBadge word={group.entries[0]} />
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
          initialQuery={imagePickerWord.image_term || imagePickerWord.word}
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
