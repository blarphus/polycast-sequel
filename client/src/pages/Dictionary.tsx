// ---------------------------------------------------------------------------
// pages/Dictionary.tsx -- Personal dictionary with collapsible entries
// ---------------------------------------------------------------------------

import '../styles/dictionary.css';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import { getDueStatus, formatDuration } from '../utils/srs';
import { formatDate } from '../utils/dateFormat';
import { renderTildeHighlight } from '../utils/tildeMarkup';
import WordLookupModal from '../components/WordLookupModal';
import ImagePicker from '../components/ImagePicker';
import { getDictionaryWordGroups, proxyImageUrl } from '../api';
import type { DictionarySortMode, DictionaryWordGroup, SavedWord } from '../api';
import { SearchIcon, SearchMinusIcon, BookPlusIcon, ChevronDownIcon, TrashIcon } from '../components/icons';
import { emitFallbackDiagnostic } from '../utils/fallbackDiagnostics';
import { useI18n } from '../hooks/useI18n';

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

function secondsBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
}

function newScheduleLabel(word: SavedWord): string {
  if (!word.due_at) return 'Scheduled for today (sync pending)';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(word.due_at);
  dueDate.setHours(0, 0, 0, 0);
  const days = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
  if (days <= 0) return 'Scheduled for today';
  if (days === 1) return 'Scheduled for tomorrow';
  return `Scheduled in ${days} days`;
}

function reviewCountdownLabel(word: SavedWord): string {
  if (!word.due_at || !word.last_reviewed_at) return 'No review schedule yet';
  const now = new Date();
  const reviewedAt = new Date(word.last_reviewed_at);
  const dueAt = new Date(word.due_at);
  const total = Math.max(1, secondsBetween(reviewedAt, dueAt));
  const elapsed = Math.min(total, secondsBetween(reviewedAt, now));
  const remaining = Math.max(0, secondsBetween(now, dueAt));
  return `${remaining === 0 ? 'Due now' : `Reappears in ${formatDuration(remaining)}`} · ${formatDuration(elapsed)} of ${formatDuration(total)} elapsed`;
}

function ReviewField({ word }: { word: SavedWord }) {
  const isNew = word.srs_interval === 0 && word.learning_step === null && !word.last_reviewed_at;
  const inLearning = word.learning_step !== null;

  if (isNew) {
    return (
      <div className="dict-field">
        <span className="dict-field-label">Review</span>
        <span className="dict-field-value text-muted">{newScheduleLabel(word)}</span>
      </div>
    );
  }

  if (inLearning) {
    return (
      <div className="dict-field">
        <span className="dict-field-label">Review</span>
        <span className="dict-field-value text-muted">
          Learning · {reviewCountdownLabel(word)}
        </span>
      </div>
    );
  }

  // Graduated review card
  const status = getDueStatus(word);
  const easePercent = Math.round(word.ease_factor * 100);
  const intervalLabel = formatDuration(word.srs_interval);
  const countdown = reviewCountdownLabel(word);

  return (
    <div className="dict-field">
      <span className="dict-field-label">Review</span>
      <span className="dict-field-value text-muted">
        {status.label} &middot; {countdown} &middot; Ease: {easePercent}% &middot; Interval: {intervalLabel}
      </span>
    </div>
  );
}

function parseWordForms(forms: string | null | undefined): string[] {
  if (!forms) return [];
  if (forms.startsWith('[')) {
    try {
      const parsed = JSON.parse(forms);
      return Array.isArray(parsed)
        ? parsed.map((form) => String(form).trim()).filter(Boolean)
        : [];
    } catch (error) {
      emitFallbackDiagnostic({
        code: 'dictionary_forms_display_fallback',
        severity: 'warning',
        title: 'Saved forms unavailable',
        message: 'This entry had malformed structured forms, so its forms list is hidden until the data is repaired.',
        detail: error instanceof Error ? error.message : String(error),
      }, { source: 'web.dictionary', operation: 'render-word-forms' });
      return [];
    }
  }
  return forms.split(',').map((form) => form.trim()).filter(Boolean);
}

export default function Dictionary() {
  const { t } = useI18n();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    removeWord,
    addWord,
    addOptimistic,
    updateImage,
    isDefinitionSaved,
    loadWords,
  } = useSavedWords({ skipInitialLoad: true });

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<DictionarySortMode>('queue');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [expandedFormIds, setExpandedFormIds] = useState<Set<string>>(new Set());
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupInitialQuery, setLookupInitialQuery] = useState('');
  const [imagePickerWord, setImagePickerWord] = useState<SavedWord | null>(null);
  const [page, setPage] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [wordGroups, setWordGroups] = useState<DictionaryWordGroup[]>([]);
  const [dueNextGroupKeys, setDueNextGroupKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [totalGroups, setTotalGroups] = useState(0);
  const WORDS_PER_PAGE = 60;

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleForms = (id: string) => {
    setExpandedFormIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadPage = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getDictionaryWordGroups(page, pageCursors[page] ?? null, WORDS_PER_PAGE, search, sort);
      setWordGroups(data.groups);
      setDueNextGroupKeys(new Set(data.dueNextGroupKeys));
      setTotalPages(data.totalPages);
      setTotalGroups(data.totalGroups);
      setNextCursor(data.nextCursor);
      if (data.nextCursor) {
        setPageCursors((current) => {
          if (current[page + 1] === data.nextCursor) return current;
          const next = current.slice(0, page + 1);
          next[page + 1] = data.nextCursor;
          return next;
        });
      }
      if (data.page !== page) setPage(data.page);
    } finally {
      setLoading(false);
    }
  }, [page, pageCursors, search, sort]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    window.addEventListener('polycast-offline-dictionary-external-sync', loadPage);
    return () => window.removeEventListener('polycast-offline-dictionary-external-sync', loadPage);
  }, [loadPage]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const queryWord = params.get('lookup') || params.get('word') || params.get('vlcWord');
    const trimmed = queryWord?.trim();
    if (!trimmed) return;

    setLookupInitialQuery(trimmed);
    setLookupOpen(true);

    params.delete('lookup');
    params.delete('word');
    params.delete('vlcWord');
    params.delete('sentence');
    params.delete('source');

    const nextSearch = params.toString();
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!lookupOpen) return;
    void loadWords().catch(() => {});
  }, [loadWords, lookupOpen]);

  const pageGroups = wordGroups;
  const dueNextPageKeys = useMemo(
    () => (sort === 'queue' && page === 0
      ? pageGroups.filter((group) => dueNextGroupKeys.has(group.key)).map((group) => group.key)
      : []),
    [dueNextGroupKeys, page, pageGroups, sort],
  );

  const isQueueMode = sort === 'queue';

  return (
    <div className="dict-page">
      <main className="dict-main">
        <section className="home-section">
          <h2 className="section-title">{t('dictionary.title')}</h2>

          {/* Controls row */}
          <div className="dict-controls">
            <div className="dict-search-wrapper">
              <SearchIcon size={16} className="dict-search-icon" />
              <input
                type="text"
                className="form-input dict-search"
                placeholder={t('dictionary.search')}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); setPageCursors([null]); }}
              />
            </div>
            <select
              className="form-input dict-sort"
              value={sort}
              onChange={(e) => { setSort(e.target.value as DictionarySortMode); setPage(0); setPageCursors([null]); }}
            >
              <option value="queue">{t('dictionary.studyOrder')}</option>
              <option value="date">{t('dictionary.recent')}</option>
              <option value="az">A-Z</option>
              <option value="freq-high">{t('dictionary.frequencyHigh')}</option>
              <option value="freq-low">{t('dictionary.frequencyLow')}</option>
              <option value="due">{t('dictionary.dueSoon')}</option>
            </select>
            <span className="dict-count">{t('dictionary.count', { count: totalGroups, countLabel: t(totalGroups === 1 ? 'dictionary.word' : 'dictionary.words') })}</span>
            {isQueueMode && <span className="dict-order-rule">{t('dictionary.frequencyRuleShort')}</span>}
            {user?.native_language && user?.target_language && (
              <button
                className="dict-lookup-btn"
                onClick={() => {
                  setLookupInitialQuery('');
                  setLookupOpen(true);
                }}
                title={t('dictionary.lookupTitle')}
              >
                +
              </button>
            )}
          </div>

          {isQueueMode && page === 0 && !search && (
            <section className="dict-study-summary" aria-label={t('dictionary.studySummary')}>
              <div>
                <span className="dict-study-summary-label">{t('dictionary.upNext')}</span>
                <strong>{t('dictionary.newCardsCount', { count: dueNextPageKeys.length })}</strong>
              </div>
              <div>
                <span className="dict-study-summary-label">{t('dictionary.library')}</span>
                <strong>{t('dictionary.count', { count: totalGroups, countLabel: t(totalGroups === 1 ? 'dictionary.word' : 'dictionary.words') })}</strong>
              </div>
              <p>{t('dictionary.frequencyRule')}</p>
            </section>
          )}

          {loading ? (
            <p className="text-muted">{t('dictionary.loading')}</p>
          ) : totalGroups === 0 ? (
            <div className="dict-empty">
              {search ? (
                <>
                  <div className="dict-empty-icon">
                    <SearchMinusIcon size={40} strokeWidth={1.5} />
                  </div>
                  <p>{t('dictionary.noMatches')}</p>
                </>
              ) : (
                <>
                  <div className="dict-empty-icon">
                    <BookPlusIcon size={40} strokeWidth={1.5} />
                  </div>
                  <p>{t('dictionary.empty')}</p>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="dict-container">
                <div className={`dict-list${isQueueMode ? ' dict-list--queue-view' : ''}`}>
                {pageGroups.map((group) => {
                  const open = expandedKeys.has(group.key);
                  const maxFreq = group.maxFrequency;
                  const inBracket = isQueueMode && page === 0 && dueNextGroupKeys.has(group.key);
                  const studyPosition = inBracket ? dueNextPageKeys.indexOf(group.key) + 1 : null;
                  return (
                    <div
                      key={group.key}
                      className={
                        `dict-item${open ? ' open' : ''}` +
                        `${inBracket ? ' dict-item--in-bracket' : ''}`
                      }
                    >
                      <button className="dict-item-header" onClick={() => toggle(group.key)}>
                        {studyPosition != null && <span className="dict-study-position">{studyPosition}</span>}
                        <span className="dict-word-copy">
                          <span className="dict-word">{group.word}</span>
                          <span className="dict-word-meaning">{group.primaryEntry.translation}</span>
                        </span>
                        {group.primaryEntry.part_of_speech && (
                          <span className={`dict-pos-badge pos-${group.primaryEntry.part_of_speech.toLowerCase()}`}>{group.primaryEntry.part_of_speech}</span>
                        )}
                        {group.hasPriority && (
                          <span className="assigned-badge">{t('dictionary.assigned')}</span>
                        )}
                        {group.entries.length > 1 && (
                          <span className="dict-def-count">{group.entries.length}</span>
                        )}
                        {maxFreq != null && (
                          <span className="dict-frequency-label">
                            <small>{t('dictionary.frequency')}</small>
                            <strong>{maxFreq}/10</strong>
                          </span>
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
                                    <span className="dict-field-label">{t('dictionary.translation')}</span>
                                    <span className="dict-field-value">{w.translation}</span>
                                  </div>
                                  {w.definition && (
                                    <div className="dict-field">
                                      <span className="dict-field-label">{t('dictionary.definition')}</span>
                                      <span className="dict-field-value">{w.definition}</span>
                                    </div>
                                  )}
                                  {w.forms && (() => {
                                    const fl = parseWordForms(w.forms);
                                    if (fl.length === 0) return null;
                                    const formsOpen = expandedFormIds.has(w.id);
                                    return (
                                      <div className={`dict-field dict-forms-field${formsOpen ? ' open' : ''}`}>
                                        <button
                                          type="button"
                                          className="dict-forms-toggle"
                                          onClick={() => toggleForms(w.id)}
                                          aria-expanded={formsOpen}
                                        >
                                          <span className="dict-field-label">{t('dictionary.forms')}</span>
                                          <span className="dict-forms-count">{fl.length}</span>
                                          <ChevronDownIcon size={15} className="dict-forms-chevron" />
                                        </button>
                                        {formsOpen && (
                                          <span className="dict-field-value text-muted dict-forms-list">
                                            {fl.join(', ')}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                  {w.example_sentence && (
                                    <div className="dict-field">
                                      <span className="dict-field-label">{t('dictionary.example')}</span>
                                      <span className="dict-field-value dict-example">
                                        {renderTildeHighlight(w.example_sentence, 'dict-highlight')}
                                      </span>
                                    </div>
                                  )}
                                  <div className="dict-field">
                                    <span className="dict-field-label">{t('dictionary.saved')}</span>
                                    <span className="dict-field-value text-muted">{formatDate(w.created_at)}</span>
                                  </div>
                                  <ReviewField word={w} />
                                  {w.frequency_count != null && (
                                    <div className="dict-field">
                                      <span className="dict-field-label">{t('dictionary.corpusCount')}</span>
                                      <span className="dict-field-value text-muted">
                                        {w.frequency_count.toLocaleString()}
                                      </span>
                                    </div>
                                  )}
                                  <div className="dict-field">
                                    <span className="dict-field-label">{t('dictionary.frequencyRank')}</span>
                                    <span className="dict-field-value text-muted">
                                      {w.lemma_frequency_rank != null ? `Lemma #${w.lemma_frequency_rank.toLocaleString()}` : t('dictionary.unranked')}
                                      {w.sense_rank != null ? ` · Sense list #${w.sense_rank.toLocaleString()}` : ''}
                                      {w.frequency_confidence ? ` · ${w.frequency_confidence} confidence` : ''}
                                    </span>
                                  </div>
                                  {Array.isArray(w.frequency_sources) && w.frequency_sources.length > 0 && (
                                    <div className="dict-field">
                                      <span className="dict-field-label">{t('dictionary.frequencySources')}</span>
                                      <span className="dict-field-value text-muted">
                                        {w.frequency_sources.map((source) => String(source.id || 'unknown')).join(', ')}
                                      </span>
                                    </div>
                                  )}
                                  {Array.isArray(w.ranking_diagnostics) && w.ranking_diagnostics.map((diagnostic) => (
                                    <div className="dict-field" key={`${w.id}-${diagnostic.code}`} role="status">
                                      <span className="dict-field-label">{t('dictionary.rankingFallback')}</span>
                                      <span className="dict-field-value text-muted">
                                        {diagnostic.title}: {diagnostic.message} · {diagnostic.code}
                                        {diagnostic.detail ? ` · ${diagnostic.detail}` : ''}
                                      </span>
                                    </div>
                                  ))}
                                  <button className="dict-remove-btn" onClick={async () => {
                                    await removeWord(w.id);
                                    await loadPage();
                                  }}>
                                    <TrashIcon size={16} />
                                    {t('dictionary.remove')}
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
                    onClick={() => { if (nextCursor) setPage((p) => p + 1); }}
                    disabled={!nextCursor}
                  >
                    Next &rarr;
                  </button>
                </div>
              )}
            </>
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
          onSelect={async (url) => {
            await updateImage(imagePickerWord.id, url);
            await loadPage();
          }}
          onClose={() => setImagePickerWord(null)}
        />
      )}

      {lookupOpen && user?.native_language && user?.target_language && (
        <WordLookupModal
          key={lookupInitialQuery || 'manual'}
          targetLang={user.target_language}
          nativeLang={user.native_language}
          initialQuery={lookupInitialQuery || undefined}
          isDefinitionSaved={isDefinitionSaved}
          onSave={async (data) => {
            const saved = await addWord(data);
            await loadPage();
            return saved;
          }}
          onOptimisticSave={addOptimistic}
          onClose={() => {
            setLookupOpen(false);
            setLookupInitialQuery('');
          }}
        />
      )}
    </div>
  );
}
