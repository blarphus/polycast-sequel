// ---------------------------------------------------------------------------
// pages/ReadArticle.tsx -- In-app news article reader with CEFR level switching
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import { getNewsArticle, streamNewsArticleRewrite, type ArticleDetail } from '../api';
import type { PopupState } from '../textTokens';
import TokenizedText from '../components/TokenizedText';
import WordPopup from '../components/WordPopup';

const CEFR_LEVELS = ['Original', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

interface NavState {
  title?: string;
  source?: string;
  image?: string | null;
  link?: string;
}

export default function ReadArticle() {
  const { lang, index } = useParams<{ lang: string; index: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state || {}) as NavState;
  const { user, loading: authLoading } = useAuth();
  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord } = useSavedWords();

  const profileLevel = user?.cefr_level || 'Original';
  const [selectedLevel, setSelectedLevel] = useState('Original');
  const [article, setArticle] = useState<ArticleDetail | null>(
    navState.title
      ? { title: navState.title, source: navState.source || '', link: navState.link || '', image: navState.image || null, body: null, level: null }
      : null,
  );
  const [bodyLoading, setBodyLoading] = useState(true);
  const [error, setError] = useState('');
  const [popup, setPopup] = useState<PopupState | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamQueueRef = useRef<string[]>([]);
  const streamTimerRef = useRef<number | null>(null);
  const streamDoneRef = useRef<ArticleDetail | null>(null);

  const idx = parseInt(index || '0', 10);

  const clearStreamState = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    streamQueueRef.current = [];
    streamDoneRef.current = null;
    if (streamTimerRef.current) {
      window.clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  }, []);

  const flushStreamQueue = useCallback(() => {
    if (streamTimerRef.current) return;

    const step = () => {
      const nextBatch = streamQueueRef.current.splice(0, 2).join('');
      if (nextBatch) {
        setArticle((prev) => (
          prev
            ? { ...prev, body: `${prev.body || ''}${nextBatch}` }
            : prev
        ));
      }

      if (streamQueueRef.current.length > 0) {
        streamTimerRef.current = window.setTimeout(step, 24);
        return;
      }

      streamTimerRef.current = null;
      if (streamDoneRef.current) {
        const finalArticle = streamDoneRef.current;
        streamDoneRef.current = null;
        setArticle((prev) => (prev ? { ...prev, ...finalArticle } : finalArticle));
        setBodyLoading(false);
      }
    };

    streamTimerRef.current = window.setTimeout(step, 24);
  }, []);

  const fetchArticle = useCallback(async (level: string, isLevelSwitch: boolean) => {
    if (!lang) return;
    clearStreamState();
    setBodyLoading(true);
    setError('');

    // On level switch, clear the body so the old text doesn't linger
    if (isLevelSwitch) {
      setArticle((prev) => prev ? { ...prev, body: null } : prev);
    }

    try {
      if (level !== 'Original') {
        const controller = new AbortController();
        streamAbortRef.current = controller;

        await streamNewsArticleRewrite(lang, idx, level, {
          signal: controller.signal,
          onMeta: (meta) => {
            setArticle((prev) => ({
              ...(prev || { body: null, extractionFailed: false, rewriteFailed: false }),
              ...meta,
              body: '',
            }));
          },
          onChunk: (text) => {
            const tokens = text.match(/\S+\s*|\s+/g) || [text];
            streamQueueRef.current.push(...tokens);
            flushStreamQueue();
          },
          onDone: (finalArticle) => {
            streamDoneRef.current = finalArticle;
            if (!streamQueueRef.current.length && !streamTimerRef.current) {
              setArticle((prev) => (prev ? { ...prev, ...finalArticle } : finalArticle));
              setBodyLoading(false);
              streamDoneRef.current = null;
            }
          },
        });

        return;
      }

      const data = await getNewsArticle(lang, idx, null);
      setArticle(data);
      setBodyLoading(false);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Failed to fetch article:', err);
      setError(err instanceof Error ? err.message : String(err));
      setBodyLoading(false);
    }
  }, [clearStreamState, flushStreamQueue, lang, idx]);

  useEffect(() => {
    if (!lang || authLoading || Number.isNaN(idx)) return;

    setSelectedLevel(profileLevel);
    setPopup(null);
    fetchArticle(profileLevel, false);
    return () => {
      clearStreamState();
    };
  }, [authLoading, clearStreamState, fetchArticle, idx, lang, profileLevel]);

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
  const hasBody = article?.body != null && article.body.length > 0;
  const isRewriting = bodyLoading && selectedLevel !== 'Original';
  const isRewritten = !bodyLoading && selectedLevel !== 'Original' && hasBody && !article?.extractionFailed;

  // Show the header if we have metadata from nav state or from the API
  const showHeader = article != null;

  return (
    <div className="read-page">
      {/* Top bar */}
      <div className="read-topbar">
        <button className="watch-back-btn" onClick={() => navigate(-1)}>
          <span className="watch-back-arrow">&lsaquo;</span> Back
        </button>

        <select
          className="read-level-selector"
          value={selectedLevel}
          onChange={handleLevelChange}
          disabled={authLoading || (!hasBody && bodyLoading)}
        >
          {CEFR_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>{lvl}</option>
          ))}
        </select>
      </div>

      {/* Full-page loading only if we have no metadata at all */}
      {!showHeader && authLoading && (
        <div className="read-loading">
          <div className="loading-spinner" />
        </div>
      )}

      {/* Error state */}
      {!bodyLoading && error && (
        <div className="read-extraction-failed">
          <p>{error}</p>
          <button className="read-external-btn" onClick={() => navigate('/')}>
            Back to Home
          </button>
        </div>
      )}

      {/* Article content — header + image shown immediately */}
      {showHeader && (
        <>
          {/* Header */}
          <div className="read-header">
            <a
              className="read-title-link"
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              <h1 className="read-title">{article.title}</h1>
            </a>
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
              {/* Rewriting indicator while streaming */}
              {isRewriting && (
                <div className="read-level-banner read-level-banner--loading">
                  <div className="loading-spinner loading-spinner--small" />
                  <span>Rewriting article at {selectedLevel} level...</span>
                </div>
              )}

              {/* Rewritten banner after loading */}
              {isRewritten && (
                <div className="read-level-banner">
                  <span>
                    This article has been rewritten at <strong>{selectedLevel}</strong> level.{' '}
                    <button
                      className="read-level-banner-link"
                      type="button"
                      onClick={() => {
                        setSelectedLevel('Original');
                        setPopup(null);
                        fetchArticle('Original', true);
                      }}
                    >
                      See original text
                    </button>
                  </span>
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

              {/* Body loading indicator (original text) */}
              {bodyLoading && !hasBody && !isRewriting && (
                <div className="read-body-loading">
                  <div className="loading-spinner" />
                </div>
              )}
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
