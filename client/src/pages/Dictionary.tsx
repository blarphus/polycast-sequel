// ---------------------------------------------------------------------------
// pages/Dictionary.tsx -- Personal dictionary page for managing saved words
// ---------------------------------------------------------------------------

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSavedWords } from '../hooks/useSavedWords';

export default function Dictionary() {
  const navigate = useNavigate();
  const { words, loading, removeWord } = useSavedWords();

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="home-header-left">
          <h1 className="home-logo">Polycast</h1>
        </div>
        <div className="home-header-right">
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            Back to Home
          </button>
        </div>
      </header>

      <main className="home-main">
        <section className="home-section">
          <h2 className="section-title">My Dictionary</h2>

          {loading ? (
            <p className="text-muted">Loading saved words...</p>
          ) : words.length === 0 ? (
            <p className="text-muted">
              No saved words yet. Click on words in subtitles and press + to save them.
            </p>
          ) : (
            <div className="dictionary-list">
              {words.map((w) => (
                <div key={w.id} className="dictionary-item">
                  <div className="dictionary-item-main">
                    <span className="dictionary-word">{w.word}</span>
                    <span className="dictionary-translation">{w.translation}</span>
                  </div>
                  {w.definition && (
                    <p className="dictionary-definition">{w.definition}</p>
                  )}
                  <div className="dictionary-item-meta">
                    <span className="text-muted">{formatDate(w.created_at)}</span>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => removeWord(w.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
