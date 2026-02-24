// ---------------------------------------------------------------------------
// pages/Dictionary.tsx -- Personal dictionary with collapsible entries
// ---------------------------------------------------------------------------

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import BottomToolbar from '../components/BottomToolbar';

// -- FrequencyDots: maps Gemini 1-10 → 1-5 display dots --------------------

const DOT_COLORS = ['#ff4d4d', '#ff944d', '#ffdd4d', '#75d147', '#4ade80'];

function FrequencyDots({ frequency }: { frequency: number | null }) {
  if (frequency == null) return null;
  const filled = Math.ceil(frequency / 2);
  return (
    <span className="freq-dots" title={`Frequency: ${frequency}/10`}>
      {DOT_COLORS.map((color, i) => (
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

// -- Example sentence renderer: ~word~ → highlighted span -------------------

function renderExample(text: string) {
  const parts = text.split(/~([^~]+)~/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="dict-highlight">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

// -- Sort options -----------------------------------------------------------

type SortMode = 'date' | 'az' | 'freq-high' | 'freq-low';

export default function Dictionary() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { words, loading, removeWord } = useSavedWords();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('date');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = words;
    if (q) {
      list = list.filter(
        (w) =>
          w.word.toLowerCase().includes(q) ||
          w.translation.toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    switch (sort) {
      case 'az':
        sorted.sort((a, b) => a.word.localeCompare(b.word));
        break;
      case 'freq-high':
        sorted.sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0));
        break;
      case 'freq-low':
        sorted.sort((a, b) => (a.frequency ?? 0) - (b.frequency ?? 0));
        break;
      default:
        break; // already sorted by date DESC from API
    }
    return sorted;
  }, [words, search, sort]);

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

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
            <input
              type="text"
              className="form-input dict-search"
              placeholder="Search words..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="form-input dict-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
            >
              <option value="date">Recent first</option>
              <option value="az">A-Z</option>
              <option value="freq-high">Frequency high → low</option>
              <option value="freq-low">Frequency low → high</option>
            </select>
            <span className="dict-count">{filtered.length} word{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <p className="text-muted">Loading saved words...</p>
          ) : filtered.length === 0 ? (
            <p className="dict-empty">
              {search
                ? 'No words match your search.'
                : 'No saved words yet. Click on words in subtitles and press + to save them.'}
            </p>
          ) : (
            <div className="dict-list">
              {filtered.map((w) => {
                const open = expandedIds.has(w.id);
                return (
                  <div key={w.id} className={`dict-item${open ? ' open' : ''}`}>
                    <button className="dict-item-header" onClick={() => toggle(w.id)}>
                      <span className="dict-word">{w.word}</span>
                      <FrequencyDots frequency={w.frequency} />
                      <svg className="dict-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {open && (
                      <div className="dict-item-body">
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
                              {renderExample(w.example_sentence)}
                            </span>
                          </div>
                        )}
                        <div className="dict-field">
                          <span className="dict-field-label">Saved</span>
                          <span className="dict-field-value text-muted">{formatDate(w.created_at)}</span>
                        </div>
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
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <BottomToolbar />
    </div>
  );
}
