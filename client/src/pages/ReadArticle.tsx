// ---------------------------------------------------------------------------
// pages/ReadArticle.tsx -- In-app news article reader with CEFR level switching
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import { getNewsArticle, type ArticleDetail } from '../api';
import type { PopupState } from '../textTokens';
import TokenizedText from '../components/TokenizedText';
import WordPopup from '../components/WordPopup';

const CEFR_LEVELS = ['Original', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export default function ReadArticle() {
  const { lang, index } = useParams<{ lang: string; index: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord } = useSavedWords();

  const defaultLevel = user?.cefr_level || 'Original';
  const [selectedLevel, setSelectedLevel] = useState(defaultLevel);
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [levelLoading, setLevelLoading] = useState(false);
  const [error, setError] = useState('');
  const [popup, setPopup] = useState<PopupState | null>(null);

  const idx = parseInt(index || '0', 10);

  const fetchArticle = useCallback(async (level: string, isLevelSwitch: boolean) => {
    if (!lang) return;
    if (isLevelSwitch) {
      setLevelLoading(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const data = await getNewsArticle(lang, idx, level !== 'Original' ? level : null);
      setArticle(data);
    } catch (err) {
      console.error('Failed to fetch article:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setLevelLoading(false);
    }
  }, [lang, idx]);

  useEffect(() => {
    fetchArticle(defaultLevel, false);
  }, [fetchArticle]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleLevelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const level = e.target.value;
    setSelectedLevel(level);
    setPopup(null);
    fetchArticle(level, true);
  }

  function handleWordClick(e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({ word, sentence, rect });
  }

  const paragraphs = article?.body?.split(/\n\n+/) || [];

  return (
    <div className="read-page">
      {/* Top bar */}
      <div className="read-topbar">
        <button className="watch-back-btn" onClick={() => navigate('/')}>
          <span className="watch-back-arrow">&lsaquo;</span> Back
        </button>

        <select
          className="read-level-selector"
          value={selectedLevel}
          onChange={handleLevelChange}
          disabled={loading || !article?.body}
        >
          {CEFR_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>{lvl}</option>
          ))}
        </select>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="read-loading">
          <div className="loading-spinner" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="read-extraction-failed">
          <p>{error}</p>
          <button className="read-external-btn" onClick={() => navigate('/')}>
            Back to Home
          </button>
        </div>
      )}

      {/* Article content */}
      {!loading && !error && article && (
        <>
          {/* Header */}
          <div className="read-header">
            <h1 className="read-title">{article.title}</h1>
            {article.source && (
              <span className="read-source">{article.source}</span>
            )}
          </div>

          {/* Hero image */}
          {article.image && (
            <div className="read-hero-image">
              <img src={article.image} alt="" />
            </div>
          )}

          {/* Extraction failed */}
          {article.extractionFailed ? (
            <div className="read-extraction-failed">
              <p>Could not load article text. The source may be behind a paywall or blocking extraction.</p>
              <a
                className="read-external-btn"
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                Read on {article.source || 'source'}
              </a>
            </div>
          ) : (
            <div className="read-body">
              {/* Level loading overlay */}
              {levelLoading && (
                <div className="read-level-loading">
                  <div className="loading-spinner" />
                  <span>Rewriting at {selectedLevel}...</span>
                </div>
              )}

              {article.rewriteFailed && (
                <p className="read-rewrite-warning">
                  Could not rewrite at the selected level. Showing original text.
                </p>
              )}

              {paragraphs.map((p, i) => {
                const trimmed = p.trim();
                if (!trimmed) return null;

                // ## heading
                if (trimmed.startsWith('## ')) {
                  return (
                    <h2 key={i} className="read-subheading">
                      <TokenizedText
                        text={trimmed.slice(3)}
                        savedWords={savedWordsSet}
                        onWordClick={handleWordClick}
                      />
                    </h2>
                  );
                }

                // **bold** lede paragraph
                const isBold = trimmed.startsWith('**') && trimmed.endsWith('**');
                const text = isBold ? trimmed.slice(2, -2) : trimmed;

                return (
                  <p key={i} className={`read-paragraph${isBold ? ' read-paragraph--lede' : ''}`}>
                    <TokenizedText
                      text={text}
                      savedWords={savedWordsSet}
                      onWordClick={handleWordClick}
                    />
                  </p>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Word popup */}
      {popup && user && (
        <WordPopup
          word={popup.word}
          sentence={popup.sentence}
          nativeLang={user.native_language || 'en'}
          targetLang={lang}
          anchorRect={popup.rect}
          onClose={() => setPopup(null)}
          isWordSaved={isWordSaved}
          isDefinitionSaved={isDefinitionSaved}
          onSaveWord={addWord}
        />
      )}
    </div>
  );
}
