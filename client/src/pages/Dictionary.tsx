// ---------------------------------------------------------------------------
// pages/Dictionary.tsx -- Personal dictionary with collapsible entries
// ---------------------------------------------------------------------------

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import { getDueStatus, formatDuration } from '../utils/srs';
import { formatDate } from '../utils/dateFormat';
import { renderTildeHighlight } from '../utils/tildeMarkup';
import WordLookupModal from '../components/WordLookupModal';
import ImagePicker from '../components/ImagePicker';
import type { SavedWord } from '../api';

// -- FrequencyDots: maps Gemini 1-10 → 1-5 display dots --------------------

const LEVEL_COLORS = ['#ff4d4d', '#ff944d', '#ffdd4d', '#75d147', '#4ade80'];

function FrequencyDots({ frequency }: { frequency: number | null }) {
  if (frequency == null) return null;
  const filled = Math.ceil(frequency / 2);
  const color = LEVEL_COLORS[filled - 1] || LEVEL_COLORS[0];
  return (
    <span className="freq-dots" title={`Frequency: ${frequency}/10`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="freq-dot"
          style={{
            background: color,
            opacity: i < filled ? 1 : 0.25,
          }}
        />
      ))}
    </span>
  );
}

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

// -- Sort options -----------------------------------------------------------

type SortMode = 'date' | 'az' | 'freq-high' | 'freq-low' | 'due';

interface WordGroup {
  key: string;
  word: string;
  target_language: string | null;
  entries: SavedWord[];
}

export default function Dictionary() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { words, loading, removeWord, addWord, updateImage } = useSavedWords();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('date');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [imagePickerWord, setImagePickerWord] = useState<SavedWord | null>(null);

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

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  return (
    <div className="home-page">
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

      <main className="home-main">
        <section className="home-section">
          <h2 className="section-title">My Dictionary</h2>

          {/* Controls row */}
          <div className="dict-controls">
            <div className="dict-search-wrapper">
              <svg className="dict-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="form-input dict-search"
                placeholder="Search words..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="form-input dict-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
            >
              <option value="date">Recent first</option>
              <option value="az">A-Z</option>
              <option value="freq-high">Frequency high → low</option>
              <option value="freq-low">Frequency low → high</option>
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
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      <line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                  </div>
                  <p>No words match your search.</p>
                </>
              ) : (
                <>
                  <div className="dict-empty-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                      <line x1="12" y1="8" x2="12" y2="14" />
                      <line x1="9" y1="11" x2="15" y2="11" />
                    </svg>
                  </div>
                  <p>No saved words yet. Click on words in subtitles and press + to save them.</p>
                </>
              )}
            </div>
          ) : (
            <div className="dict-list">
              {wordGroups.map((group) => {
                const open = expandedKeys.has(group.key);
                const maxFreq = Math.max(...group.entries.map((e) => e.frequency ?? 0)) || null;
                const freqColor = maxFreq != null ? LEVEL_COLORS[Math.ceil(maxFreq / 2) - 1] || LEVEL_COLORS[0] : undefined;
                return (
                  <div
                    key={group.key}
                    className={`dict-item${open ? ' open' : ''}`}
                    style={freqColor ? { borderLeftColor: freqColor } : undefined}
                  >
                    <button className="dict-item-header" onClick={() => toggle(group.key)}>
                      <span className="dict-word">{group.word}</span>
                      <FrequencyDots frequency={maxFreq} />
                      {group.entries.length > 1 && (
                        <span className="dict-def-count">{group.entries.length}</span>
                      )}
                      <DueStatusBadge word={group.entries[0]} />
                      <svg className="dict-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {open && (
                      <div className="dict-item-body">
                        {group.entries.map((w) => (
                          <div key={w.id} className="dict-definition-card">
                            <div className="dict-def-layout">
                              <div className="dict-def-info">
                                {w.part_of_speech && (
                                  <span className="dict-pos-badge">{w.part_of_speech}</span>
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
                                <button className="dict-remove-btn" onClick={() => removeWord(w.id)}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                    <path d="M10 11v6" />
                                    <path d="M14 11v6" />
                                  </svg>
                                  Remove
                                </button>
                              </div>
                              <div className="dict-image-block">
                                {w.image_url ? (
                                  <>
                                    <img
                                      className="dict-def-image dict-word-image--clickable"
                                      src={w.image_url}
                                      alt={w.word}
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
          )}
        </section>
      </main>

      {lightboxUrl && (
        <div className="dict-lightbox" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl.replace(/\/\d+px-/, '/800px-')} alt="Enlarged" />
        </div>
      )}

      {imagePickerWord && (
        <ImagePicker
          initialQuery={imagePickerWord.word}
          onSelect={async (url) => { await updateImage(imagePickerWord.id, url); }}
          onClose={() => setImagePickerWord(null)}
        />
      )}

      {lookupOpen && user?.native_language && user?.target_language && (
        <WordLookupModal
          targetLang={user.target_language}
          nativeLang={user.native_language}
          onSave={addWord}
          onClose={() => setLookupOpen(false)}
        />
      )}
    </div>
  );
}
