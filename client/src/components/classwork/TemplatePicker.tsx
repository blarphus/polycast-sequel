import React, { useState, useEffect } from 'react';
import * as api from '../../api';
import type { TemplateSummary } from '../../api';

interface Props {
  onSelect: (data: { title: string; words: (string | Record<string, unknown>)[]; language: string }) => void;
  onClose: () => void;
}

export default function TemplatePicker({ onSelect, onClose }: Props) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadingUnit, setLoadingUnit] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.getTemplates()
      .then((res) => {
        setTemplates(res.templates);
        const initial: Record<string, boolean> = {};
        res.templates.forEach((book, i) => { initial[book.id] = i > 0; });
        setCollapsed(initial);
      })
      .catch((err) => {
        console.error('Failed to load templates:', err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleUnitClick = async (textbookId: string, unitId: string) => {
    if (loadingUnit) return;
    setLoadingUnit(unitId);
    try {
      const res = await api.getTemplateUnit(textbookId, unitId);
      onSelect({
        title: res.unit.title,
        words: res.unit.words,
        language: res.textbook.language,
      });
    } catch (err) {
      console.error('Failed to load template unit:', err);
      setLoadingUnit(null);
    }
  };

  const toggleLevel = (bookId: string) => {
    setCollapsed(prev => ({ ...prev, [bookId]: !prev[bookId] }));
  };

  return (
    <div className="lookup-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lookup-modal template-picker-modal">
        <div className="lookup-header">
          <span className="lookup-title">Browse Templates</span>
          <button className="word-popup-close" onClick={onClose}>&times;</button>
        </div>

        {loading && (
          <div className="lookup-center">
            <div className="loading-spinner" />
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}

        {!loading && !error && (
          <div className="template-picker-list">
            {templates.map((book) => (
              <div key={book.id} className="template-level-group">
                <button
                  className="template-level-header"
                  onClick={() => toggleLevel(book.id)}
                >
                  <div className="template-level-left">
                    <span className="template-textbook-level">{book.level}</span>
                    <div className="template-level-meta">
                      <span className="template-textbook-title">{book.title}</span>
                      <span className="template-textbook-publisher">{book.units.length} units</span>
                    </div>
                  </div>
                  <span className={`template-level-chevron ${collapsed[book.id] ? '' : 'template-level-chevron--open'}`}>
                    &#x276F;
                  </span>
                </button>

                {!collapsed[book.id] && (
                  <div className="template-unit-list">
                    {book.units.map((unit) => (
                      <button
                        key={unit.id}
                        className="template-unit-row"
                        onClick={() => handleUnitClick(book.id, unit.id)}
                        disabled={loadingUnit !== null}
                      >
                        <div className="template-unit-info">
                          <div className="template-unit-title-row">
                            <span className="template-unit-title">{unit.title}</span>
                            {loadingUnit === unit.id ? (
                              <div className="loading-spinner loading-spinner--small" />
                            ) : (
                              <span className="template-unit-count">{unit.wordCount} words</span>
                            )}
                          </div>
                          <span className="template-unit-desc">{unit.description}</span>
                        </div>
                        {unit.previews && unit.previews.length > 0 && (
                          <div className="template-unit-thumbs">
                            {unit.previews.map((p, j) => (
                              <div key={j} className="template-unit-thumb-item">
                                <img src={p.image} alt={p.word} className="template-unit-thumb" />
                                <span className="template-unit-thumb-label">{p.word}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
