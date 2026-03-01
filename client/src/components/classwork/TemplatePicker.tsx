import React, { useState, useEffect } from 'react';
import * as api from '../../api';
import type { TemplateSummary } from '../../api';

interface Props {
  onSelect: (data: { title: string; words: string[]; language: string }) => void;
  onClose: () => void;
}

export default function TemplatePicker({ onSelect, onClose }: Props) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadingUnit, setLoadingUnit] = useState<string | null>(null);

  useEffect(() => {
    api.getTemplates()
      .then((res) => setTemplates(res.templates))
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
              <div key={book.id}>
                <div className="template-textbook-header">
                  <div>
                    <span className="template-textbook-title">{book.title}</span>
                    <span className="template-textbook-level">{book.level}</span>
                  </div>
                  <span className="template-textbook-publisher">{book.publisher}</span>
                </div>
                <div className="template-unit-list">
                  {book.units.map((unit) => (
                    <button
                      key={unit.id}
                      className="template-unit-row"
                      onClick={() => handleUnitClick(book.id, unit.id)}
                      disabled={loadingUnit !== null}
                    >
                      <div className="template-unit-info">
                        <span className="template-unit-title">{unit.title}</span>
                        <span className="template-unit-desc">{unit.description}</span>
                      </div>
                      {loadingUnit === unit.id ? (
                        <div className="loading-spinner loading-spinner--small" />
                      ) : (
                        <span className="template-unit-count">{unit.wordCount} words</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
