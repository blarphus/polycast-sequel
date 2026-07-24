import '../styles/dictionary.css';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import { getDueStatus, formatDuration } from '../utils/srs';
import { formatDate } from '../utils/dateFormat';
import { renderTildeHighlight } from '../utils/tildeMarkup';
import { buildDictionaryGroups } from '../utils/dictionaryGroups';
import WordLookupModal from '../components/WordLookupModal';
import ImagePicker from '../components/ImagePicker';
import { FrequencyDots } from '../components/FrequencyDots';
import {
  getDictionaryWordGroups,
  getDueWords,
  getWordAudio,
  proxyImageUrl,
} from '../api';
import type { DictionaryWordGroup, SavedWord } from '../api';
import {
  SearchIcon,
  SearchMinusIcon,
  BookPlusIcon,
  TrashIcon,
  SpeakerIcon,
  ChevronDownIcon,
} from '../components/icons';
import { emitFallbackDiagnostic } from '../utils/fallbackDiagnostics';
import { useI18n } from '../hooks/useI18n';

type DictionaryView = 'due' | 'all';

const BATCH_SIZE = 100;

function secondsBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
}

function reviewLabel(word: SavedWord): string {
  const isNew = word.srs_interval === 0 && word.learning_step === null && !word.last_reviewed_at;
  if (isNew) return getDueStatus(word).label;
  if (!word.due_at) return 'No review schedule yet';
  const dueAt = new Date(word.due_at);
  const remaining = secondsBetween(new Date(), dueAt);
  if (remaining === 0) return 'Due now';
  return `Reappears in ${formatDuration(remaining)}`;
}

function masteryScore(word: SavedWord): number {
  const attempts = word.correct_count + word.incorrect_count;
  if (attempts === 0) return 0;
  const accuracy = word.correct_count / attempts;
  const intervalDays = Math.max(0, word.srs_interval) / 86_400;
  const stability = Math.min(1, Math.log2(intervalDays + 1) / 6);
  return Math.max(1, Math.min(10, Math.round((accuracy * 0.65 + stability * 0.35) * 10)));
}

function frequencyBand(score: number | null): string {
  if (score == null) return 'Unranked';
  if (score === 10) return 'Very common';
  if (score === 9) return 'Common';
  if (score === 8) return 'Frequent';
  if (score === 7) return 'Everyday';
  if (score >= 5) return 'Occasional';
  if (score >= 3) return 'Uncommon';
  return 'Rare';
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

function groupByFrequency(groups: DictionaryWordGroup[]) {
  const grouped = new Map<number | null, DictionaryWordGroup[]>();
  for (const group of groups) {
    const key = group.maxFrequency;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(group);
    else grouped.set(key, [group]);
  }
  return Array.from(grouped.entries()).sort(([a], [b]) => (b ?? -1) - (a ?? -1));
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

  const [view, setView] = useState<DictionaryView>('due');
  const [search, setSearch] = useState('');
  const [wordGroups, setWordGroups] = useState<DictionaryWordGroup[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [batchPage, setBatchPage] = useState(0);
  const [totalGroups, setTotalGroups] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupInitialQuery, setLookupInitialQuery] = useState('');
  const [imagePickerWord, setImagePickerWord] = useState<SavedWord | null>(null);
  const [audioLoadingId, setAudioLoadingId] = useState<string | null>(null);
  const [collapsedBands, setCollapsedBands] = useState<Set<string>>(new Set());

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'due') {
        const words = await getDueWords();
        const groups = buildDictionaryGroups(words, search, 'freq-high');
        setWordGroups(groups);
        setTotalGroups(groups.length);
        setNextCursor(null);
        setBatchPage(0);
      } else {
        const data = await getDictionaryWordGroups(0, null, BATCH_SIZE, search, 'freq-high');
        setWordGroups(data.groups);
        setTotalGroups(data.totalGroups);
        setNextCursor(data.nextCursor);
        setBatchPage(data.page);
      }
    } finally {
      setLoading(false);
    }
  }, [search, view]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    window.addEventListener('polycast-offline-dictionary-external-sync', loadInitial);
    return () => window.removeEventListener('polycast-offline-dictionary-external-sync', loadInitial);
  }, [loadInitial]);

  useEffect(() => {
    if (wordGroups.length === 0) {
      setSelectedKey(null);
      setSelectedEntryId(null);
      return;
    }
    const selectedStillExists = wordGroups.some((group) => group.key === selectedKey);
    if (!selectedStillExists) setSelectedKey(wordGroups[0].key);
  }, [selectedKey, wordGroups]);

  const selectedGroup = useMemo(
    () => wordGroups.find((group) => group.key === selectedKey) ?? wordGroups[0] ?? null,
    [selectedKey, wordGroups],
  );
  const selectedEntry = useMemo(
    () => selectedGroup?.entries.find((entry) => entry.id === selectedEntryId)
      ?? selectedGroup?.primaryEntry
      ?? null,
    [selectedEntryId, selectedGroup],
  );
  const frequencyGroups = useMemo(() => groupByFrequency(wordGroups), [wordGroups]);

  useEffect(() => {
    if (selectedGroup && !selectedGroup.entries.some((entry) => entry.id === selectedEntryId)) {
      setSelectedEntryId(selectedGroup.primaryEntry.id);
    }
  }, [selectedEntryId, selectedGroup]);

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
    if (lookupOpen) void loadWords().catch(() => {});
  }, [loadWords, lookupOpen]);

  const loadMore = async () => {
    if (view !== 'all' || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await getDictionaryWordGroups(
        batchPage + 1,
        nextCursor,
        BATCH_SIZE,
        search,
        'freq-high',
      );
      setWordGroups((current) => [...current, ...data.groups]);
      setNextCursor(data.nextCursor);
      setBatchPage(data.page);
      setTotalGroups(data.totalGroups);
    } finally {
      setLoadingMore(false);
    }
  };

  const playAudio = async (word: SavedWord) => {
    setAudioLoadingId(word.id);
    try {
      const blob = await getWordAudio(word.id);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
      audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
      await audio.play();
    } finally {
      setAudioLoadingId(null);
    }
  };

  const refreshAfterMutation = async () => {
    await loadInitial();
  };

  return (
    <div className="dict-page dict-ladder-page">
      <main className="dict-main">
        <section className="home-section">
          <div className="dict-heading-row">
            <div>
              <h2 className="section-title">{t('dictionary.title')}</h2>
              <p className="dict-subtitle">Browse by real-world frequency and open any word for the full picture.</p>
            </div>
            <div className="dict-view-toggle" role="group" aria-label="Dictionary view">
              <button
                type="button"
                className={view === 'due' ? 'active' : ''}
                aria-pressed={view === 'due'}
                onClick={() => setView('due')}
              >
                Due today
              </button>
              <button
                type="button"
                className={view === 'all' ? 'active' : ''}
                aria-pressed={view === 'all'}
                onClick={() => setView('all')}
              >
                All
              </button>
            </div>
          </div>

          <div className="dict-controls dict-ladder-controls">
            <div className="dict-search-wrapper">
              <SearchIcon size={17} className="dict-search-icon" />
              <input
                type="search"
                className="form-input dict-search"
                placeholder={t('dictionary.search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <span className="dict-order-rule">Frequency order</span>
            <span className="dict-count">{totalGroups.toLocaleString()} {totalGroups === 1 ? 'word' : 'words'}</span>
            {user?.native_language && user?.target_language && (
              <button
                className="dict-lookup-btn"
                onClick={() => {
                  setLookupInitialQuery('');
                  setLookupOpen(true);
                }}
                title={t('dictionary.lookupTitle')}
                aria-label={t('dictionary.lookupTitle')}
              >
                +
              </button>
            )}
          </div>

          {loading ? (
            <div className="dict-ladder-loading">{t('dictionary.loading')}</div>
          ) : totalGroups === 0 ? (
            <div className="dict-empty">
              <div className="dict-empty-icon">
                {search ? <SearchMinusIcon size={40} strokeWidth={1.5} /> : <BookPlusIcon size={40} strokeWidth={1.5} />}
              </div>
              <p>{search ? t('dictionary.noMatches') : (view === 'due' ? 'Nothing is due today.' : t('dictionary.empty'))}</p>
            </div>
          ) : (
            <div className="dict-ladder-workspace">
              <aside className="dict-ladder-list" aria-label="Frequency ladder">
                <div className="dict-ladder-list-scroll">
                  {frequencyGroups.map(([score, groups]) => (
                    <section className="dict-frequency-section" key={score ?? 'unranked'}>
                      <button
                        type="button"
                        className="dict-frequency-heading"
                        aria-expanded={!collapsedBands.has(String(score ?? 'unranked'))}
                        onClick={() => {
                          const bandKey = String(score ?? 'unranked');
                          setCollapsedBands((current) => {
                            const next = new Set(current);
                            if (next.has(bandKey)) next.delete(bandKey);
                            else next.add(bandKey);
                            return next;
                          });
                        }}
                      >
                        <span className="dict-frequency-heading-title">
                          <ChevronDownIcon size={16} className="dict-frequency-caret" />
                          {frequencyBand(score)}
                        </span>
                        {score != null && (
                          <span className="dict-frequency-heading-score">
                            <FrequencyDots frequency={score} />
                            {score}/10
                          </span>
                        )}
                      </button>
                      {!collapsedBands.has(String(score ?? 'unranked')) && (
                        <div className="dict-frequency-rows">
                          {groups.map((group) => {
                            const active = group.key === selectedGroup?.key;
                            return (
                              <button
                                type="button"
                                className={`dict-ladder-row${active ? ' active' : ''}`}
                                key={group.key}
                                onClick={() => {
                                  setSelectedKey(group.key);
                                  setSelectedEntryId(group.primaryEntry.id);
                                }}
                                aria-current={active ? 'true' : undefined}
                              >
                                <span className="dict-ladder-word-copy">
                                  <strong>{group.word}</strong>
                                  <small>{group.primaryEntry.translation}</small>
                                </span>
                                {group.primaryEntry.part_of_speech && (
                                  <span className={`dict-pos-badge pos-${group.primaryEntry.part_of_speech.toLowerCase()}`}>
                                    {group.primaryEntry.part_of_speech}
                                  </span>
                                )}
                                <span className="dict-ladder-frequency">
                                  <FrequencyDots frequency={group.maxFrequency} />
                                  <span>{group.maxFrequency == null ? '—' : `${group.maxFrequency}/10`}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
                <footer className="dict-ladder-footer">
                  {view === 'all' && nextCursor && (
                    <button type="button" className="dict-show-more" onClick={loadMore} disabled={loadingMore}>
                      {loadingMore ? 'Loading…' : 'Show 100 more'}
                    </button>
                  )}
                  <span>{wordGroups.length.toLocaleString()} of {totalGroups.toLocaleString()} words</span>
                </footer>
              </aside>

              {selectedEntry && selectedGroup && (
                <article className="dict-detail-panel">
                  <header className="dict-detail-header">
                    <div>
                      <div className="dict-detail-title-line">
                        <h3>{selectedGroup.word}</h3>
                        <button
                          type="button"
                          className="dict-audio-btn"
                          onClick={() => void playAudio(selectedEntry)}
                          disabled={audioLoadingId === selectedEntry.id}
                          aria-label={`Play ${selectedGroup.word}`}
                        >
                          <SpeakerIcon size={20} />
                        </button>
                        {selectedEntry.part_of_speech && (
                          <span className={`dict-pos-badge pos-${selectedEntry.part_of_speech.toLowerCase()}`}>
                            {selectedEntry.part_of_speech}
                          </span>
                        )}
                      </div>
                      <p className="dict-detail-translation">{selectedEntry.translation}</p>
                    </div>
                    <span className={`dict-due-badge dict-due-badge--${getDueStatus(selectedEntry).urgency}`}>
                      {getDueStatus(selectedEntry).label}
                    </span>
                  </header>

                  {selectedGroup.entries.length > 1 && (
                    <div className="dict-sense-tabs" aria-label="Saved meanings">
                      {selectedGroup.entries.map((entry, index) => (
                        <button
                          type="button"
                          key={entry.id}
                          className={entry.id === selectedEntry.id ? 'active' : ''}
                          onClick={() => setSelectedEntryId(entry.id)}
                        >
                          Meaning {index + 1}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="dict-hero-image">
                    {selectedEntry.image_url ? (
                      <img
                        src={proxyImageUrl(selectedEntry.image_url)!}
                        alt={selectedEntry.word}
                        onClick={() => setLightboxUrl(selectedEntry.image_url)}
                      />
                    ) : (
                      <button type="button" className="dict-image-placeholder" onClick={() => setImagePickerWord(selectedEntry)}>
                        <BookPlusIcon size={30} />
                        <span>Add an image for this word</span>
                      </button>
                    )}
                    <button type="button" className="dict-change-image-btn" onClick={() => setImagePickerWord(selectedEntry)}>
                      {selectedEntry.image_url ? 'Change image' : 'Choose image'}
                    </button>
                  </div>

                  {(selectedEntry.definition || selectedEntry.example_sentence) && (
                    <section className="dict-detail-copy">
                      {selectedEntry.definition && (
                        <div>
                          <span className="dict-detail-label">Meaning</span>
                          <p>{selectedEntry.definition}</p>
                        </div>
                      )}
                      {selectedEntry.example_sentence && (
                        <div>
                          <span className="dict-detail-label">Example</span>
                          <p className="dict-detail-example">
                            {renderTildeHighlight(selectedEntry.example_sentence, 'dict-highlight')}
                          </p>
                          {selectedEntry.sentence_translation && (
                            <p className="dict-detail-example-translation">{selectedEntry.sentence_translation}</p>
                          )}
                        </div>
                      )}
                    </section>
                  )}

                  <div className="dict-detail-metrics">
                    <section>
                      <span className="dict-detail-label">Frequency</span>
                      <div className="dict-metric-value">
                        <FrequencyDots frequency={selectedGroup.maxFrequency} />
                        <strong>{selectedGroup.maxFrequency == null ? 'Unranked' : `${selectedGroup.maxFrequency}/10`}</strong>
                      </div>
                      <small>{frequencyBand(selectedGroup.maxFrequency)} in real-world language</small>
                    </section>
                    <section>
                      <span className="dict-detail-label">Mastery</span>
                      <div className="dict-metric-value dict-mastery-value">
                        <span className="dict-mastery-track">
                          <span style={{ width: `${masteryScore(selectedEntry) * 10}%` }} />
                        </span>
                        <strong>{masteryScore(selectedEntry)}/10</strong>
                      </div>
                      <small>{selectedEntry.correct_count + selectedEntry.incorrect_count} review attempts</small>
                    </section>
                  </div>

                  <dl className="dict-detail-meta">
                    <div>
                      <dt>Next review</dt>
                      <dd>{reviewLabel(selectedEntry)}</dd>
                    </div>
                    <div>
                      <dt>Saved</dt>
                      <dd>{formatDate(selectedEntry.created_at)}</dd>
                    </div>
                    {selectedEntry.frequency_count != null && (
                      <div>
                        <dt>Corpus estimate</dt>
                        <dd>{selectedEntry.frequency_count.toLocaleString()} per billion</dd>
                      </div>
                    )}
                    {parseWordForms(selectedEntry.forms).length > 0 && (
                      <div>
                        <dt>Forms</dt>
                        <dd>{parseWordForms(selectedEntry.forms).join(', ')}</dd>
                      </div>
                    )}
                  </dl>

                  {Array.isArray(selectedEntry.ranking_diagnostics) && selectedEntry.ranking_diagnostics.map((diagnostic) => (
                    <div className="dict-ranking-diagnostic" key={`${selectedEntry.id}-${diagnostic.code}`} role="status">
                      <strong>{diagnostic.title}</strong>
                      <span>{diagnostic.message} · {diagnostic.code}</span>
                      {diagnostic.detail && <small>{diagnostic.detail}</small>}
                    </div>
                  ))}

                  <div className="dict-detail-actions">
                    <button type="button" className="dict-edit-image-btn" onClick={() => setImagePickerWord(selectedEntry)}>
                      Edit image
                    </button>
                    <button
                      type="button"
                      className="dict-remove-btn"
                      onClick={async () => {
                        await removeWord(selectedEntry.id);
                        await refreshAfterMutation();
                      }}
                    >
                      <TrashIcon size={16} />
                      {t('dictionary.remove')}
                    </button>
                  </div>
                </article>
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
          onSelect={async (url) => {
            await updateImage(imagePickerWord.id, url);
            setImagePickerWord(null);
            await refreshAfterMutation();
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
            await refreshAfterMutation();
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
