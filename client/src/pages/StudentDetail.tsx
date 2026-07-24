// ---------------------------------------------------------------------------
// pages/StudentDetail.tsx -- Teacher view of a student's progress & stats
// ---------------------------------------------------------------------------

import '../styles/students.css';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import type { StudentDetail as StudentDetailData, DailyActivity, RecentSession, StudentWord } from '../api';
import { ChevronLeftIcon, CheckIcon } from '../components/icons';
import { formatDate as formatShortDate } from '../utils/dateFormat';
import { useAsyncData } from '../hooks/useAsyncData';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(n: number | null) { return n === null ? '--' : `${Math.round(n * 100)}%`; }

function formatDuration(s: number | null) {
  if (!s) return '';
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return formatShortDate(dateStr);
}

function isDueNow(word: StudentWord) {
  return !!word.due_at && new Date(word.due_at).getTime() <= Date.now();
}

function isDueToday(word: StudentWord) {
  if (!word.due_at) return false;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return new Date(word.due_at).getTime() <= endOfToday.getTime();
}

function reviewLabel(word: StudentWord) {
  if (!word.due_at) return 'Unscheduled';
  if (isDueNow(word)) return 'Due now';
  const due = new Date(word.due_at);
  const today = new Date();
  if (localDateKey(due) === localDateKey(today)) return `Later today · ${due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return `Due ${formatShortDate(word.due_at)}`;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const SESSION_LABELS: Record<string, { label: string; color: string }> = {
  vocabulary: { label: 'Practice', color: '#6366f1' },
  flashcards: { label: 'Flashcards', color: '#14b8a6' },
  drill: { label: 'Drill', color: '#f59e0b' },
  voice: { label: 'Voice', color: '#06b6d4' },
};

// ---------------------------------------------------------------------------
// 30-day heatmap calendar with clickable day detail
// ---------------------------------------------------------------------------

function totalActivity(d: DailyActivity): number {
  return d.reviews + d.wordsAdded + d.practiceSessions + d.drills + d.voiceSessions;
}

type DayStatus = 'completed' | 'partial' | 'skipped' | 'inactive';

function dayStatus(d: DailyActivity | undefined, beforeAccount: boolean): DayStatus {
  if (beforeAccount) return 'inactive';
  if (!d) return 'skipped';
  if (d.reviews > 0) return 'completed';
  if (totalActivity(d) > 0) return 'partial';
  return 'skipped';
}

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function MonthCalendar({ activity, accountCreated, selectedDay, onSelectDay }: {
  activity: DailyActivity[];
  accountCreated: string;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}) {
  const activityMap = new Map(activity.map((d) => [d.day, d]));
  const today = new Date();
  const todayStr = localDateKey(today);
  const createdStr = accountCreated.slice(0, 10);

  type Cell = { date: string; day: number; status: DayStatus } | null;
  const days: { date: string; weekday: number; day: number; status: DayStatus }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = localDateKey(d);
    const beforeAccount = dateStr < createdStr;
    const data = activityMap.get(dateStr);
    days.push({ date: dateStr, weekday: d.getDay(), day: d.getDate(), status: dayStatus(data, beforeAccount) });
  }

  const rows: Cell[][] = [];
  let row: Cell[] = new Array(7).fill(null);
  for (const d of days) {
    row[d.weekday] = { date: d.date, day: d.day, status: d.status };
    if (d.weekday === 6) { rows.push(row); row = new Array(7).fill(null); }
  }
  if (row.some((c) => c !== null)) rows.push(row);

  return (
    <div className="sd-heatmap">
      <div className="sd-heatmap-header">
        {DAY_HEADERS.map((d) => <span key={d} className="sd-heatmap-day-label">{d}</span>)}
      </div>
      {rows.map((r, ri) => (
        <div key={ri} className="sd-heatmap-row">
          {r.map((cell, ci) => {
            if (!cell) return <div key={ci} className="sd-heatmap-cell sd-heatmap-cell--blank" />;
            const isToday = cell.date === todayStr;
            const clickable = cell.status !== 'inactive';
            return (
              <button
                key={ci}
                className={`sd-heatmap-cell sd-heatmap-cell--${cell.status}${selectedDay === cell.date ? ' sd-heatmap-cell--selected' : ''}${isToday ? ' sd-heatmap-cell--today' : ''}`}
                onClick={clickable ? () => onSelectDay(selectedDay === cell.date ? null : cell.date) : undefined}
                disabled={!clickable}
              >
                <span className="sd-heatmap-date">{cell.day}</span>
              </button>
            );
          })}
        </div>
      ))}
      <div className="sd-heatmap-legend">
        <span className="sd-heatmap-legend-cell sd-heatmap-cell--completed" />
        <span className="sd-heatmap-legend-label">Review activity</span>
        <span className="sd-heatmap-legend-cell sd-heatmap-cell--partial" />
        <span className="sd-heatmap-legend-label">Some activity</span>
        <span className="sd-heatmap-legend-cell sd-heatmap-cell--skipped" />
        <span className="sd-heatmap-legend-label">Skipped</span>
        <span className="sd-heatmap-legend-cell sd-heatmap-cell--inactive" />
        <span className="sd-heatmap-legend-label">N/A</span>
      </div>
    </div>
  );
}

function DayOverlay({ day, activity, onClose }: { day: string; activity: DailyActivity[]; onClose: () => void }) {
  const data = activity.find((a) => a.day === day);
  const dateLabel = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const total = data ? totalActivity(data) : 0;

  const reviewed = data?.words.filter((w) => w.action === 'reviewed') ?? [];
  const added = data?.words.filter((w) => w.action === 'added') ?? [];
  const uniqueReviewed = [...new Map(reviewed.map((w) => [w.word, w])).values()];

  return (
    <div className="sd-overlay" onClick={onClose}>
      <div className="sd-overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sd-overlay-header">
          <h2 className="sd-overlay-title">{dateLabel}</h2>
          <button className="sd-overlay-close" onClick={onClose}>
            <ChevronLeftIcon size={20} />
          </button>
        </div>

        {total === 0 ? (
          <p className="sd-empty">No activity on this day.</p>
        ) : (
          <>
            <div className="sd-overlay-stats">
              {data!.reviews > 0 && <div className="sd-overlay-stat"><span className="sd-overlay-stat-value">{data!.reviews}</span><span className="sd-overlay-stat-label">Reviews</span></div>}
              {data!.wordsAdded > 0 && <div className="sd-overlay-stat"><span className="sd-overlay-stat-value">{data!.wordsAdded}</span><span className="sd-overlay-stat-label">Words added</span></div>}
              {data!.practiceSessions > 0 && <div className="sd-overlay-stat"><span className="sd-overlay-stat-value">{data!.practiceCorrect}/{data!.practiceTotal}</span><span className="sd-overlay-stat-label">Practice</span></div>}
              {data!.drills > 0 && <div className="sd-overlay-stat"><span className="sd-overlay-stat-value">{data!.drills}</span><span className="sd-overlay-stat-label">Drill{data!.drills > 1 ? 's' : ''}</span></div>}
              {data!.voiceSessions > 0 && <div className="sd-overlay-stat"><span className="sd-overlay-stat-value">{data!.voiceSessions}</span><span className="sd-overlay-stat-label">Voice</span></div>}
            </div>

            {uniqueReviewed.length > 0 && (
              <div className="sd-overlay-section">
                <h3 className="sd-overlay-section-title">Words reviewed ({uniqueReviewed.length})</h3>
                <div className="sd-overlay-word-list">
                  {uniqueReviewed.map((w, i) => (
                    <div key={i} className="sd-overlay-word-row">
                      <span className="sd-overlay-word-term">{w.word}</span>
                      <span className="sd-overlay-word-translation">{w.translation}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {added.length > 0 && (
              <div className="sd-overlay-section">
                <h3 className="sd-overlay-section-title">Words added ({added.length})</h3>
                <div className="sd-overlay-word-list">
                  {added.map((w, i) => (
                    <div key={i} className="sd-overlay-word-row">
                      <span className="sd-overlay-word-term">{w.word}</span>
                      <span className="sd-overlay-word-translation">{w.translation}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SRS progress bar
// ---------------------------------------------------------------------------

function SrsProgressBar({ words }: { words: StudentDetailData['words'] }) {
  const total = words.length;
  if (total === 0) return null;
  const counts = { new: 0, learning: 0, review: 0, mastered: 0 };
  for (const w of words) counts[w.srs_stage]++;

  const segments: { stage: string; count: number; color: string; label: string }[] = [
    { stage: 'mastered', count: counts.mastered, color: '#22c55e', label: 'Mastered' },
    { stage: 'review', count: counts.review, color: '#3b82f6', label: 'Review' },
    { stage: 'learning', count: counts.learning, color: '#f59e0b', label: 'Learning' },
    { stage: 'new', count: counts.new, color: 'var(--text-muted)', label: 'New' },
  ];

  return (
    <div className="sd-srs-bar-section">
      <div className="sd-srs-bar">
        {segments.map((s) => s.count > 0 && (
          <div key={s.stage} className="sd-srs-bar-segment" style={{ width: `${(s.count / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.count}`} />
        ))}
      </div>
      <div className="sd-srs-legend">
        {segments.map((s) => (
          <span key={s.stage} className="sd-srs-legend-item">
            <span className="sd-srs-legend-dot" style={{ background: s.color }} />
            {s.count} {s.label.toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

const STUDENT_WORD_BATCH = 100;

function StudentVocabularyPanel({ words }: { words: StudentWord[] }) {
  const [view, setView] = useState<'due' | 'all'>('due');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(STUDENT_WORD_BATCH);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const dueCount = useMemo(() => words.filter(isDueToday).length, [words]);
  const filteredWords = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return words
      .filter((word) => view === 'all' || isDueToday(word))
      .filter((word) => !needle
        || word.word.toLocaleLowerCase().includes(needle)
        || (word.translation || '').toLocaleLowerCase().includes(needle))
      .sort((a, b) => {
        if (view === 'due') {
          return new Date(a.due_at || 0).getTime() - new Date(b.due_at || 0).getTime()
            || a.word.localeCompare(b.word);
        }
        return a.word.localeCompare(b.word);
      });
  }, [search, view, words]);

  useEffect(() => {
    setVisibleCount(STUDENT_WORD_BATCH);
  }, [search, view]);

  useEffect(() => {
    if (!filteredWords.some((word) => word.id === selectedId)) {
      setSelectedId(filteredWords[0]?.id || null);
    }
  }, [filteredWords, selectedId]);

  const visibleWords = filteredWords.slice(0, visibleCount);
  const selectedWord = words.find((word) => word.id === selectedId) || null;
  const totalAnswers = selectedWord
    ? selectedWord.correct_count + selectedWord.incorrect_count
    : 0;
  const accuracy = selectedWord && totalAnswers > 0
    ? Math.round((selectedWord.correct_count / totalAnswers) * 100)
    : null;

  return (
    <section className="sd-vocab-shell" aria-label="Student vocabulary">
      <div className="sd-vocab-toolbar">
        <div>
          <h2 className="sd-vocab-title">Vocabulary cards</h2>
          <p className="sd-vocab-subtitle">Inspect what this student can review now or browse their complete dictionary.</p>
        </div>
        <div className="sd-vocab-toggle" role="group" aria-label="Vocabulary view">
          <button
            className={view === 'due' ? 'active' : ''}
            onClick={() => setView('due')}
          >
            Due today <span>{dueCount}</span>
          </button>
          <button
            className={view === 'all' ? 'active' : ''}
            onClick={() => setView('all')}
          >
            All words <span>{words.length}</span>
          </button>
        </div>
      </div>

      <div className="sd-vocab-search-row">
        <label className="sd-vocab-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search this student's words…"
          />
        </label>
        <span className="sd-vocab-count">{filteredWords.length} {filteredWords.length === 1 ? 'word' : 'words'}</span>
      </div>

      <SrsProgressBar words={words} />

      {filteredWords.length === 0 ? (
        <div className="sd-vocab-empty">
          {search.trim()
            ? 'No words match that search.'
            : view === 'due'
              ? 'No cards are due right now.'
              : 'This student has not saved any words yet.'}
        </div>
      ) : (
        <div className="sd-vocab-workspace">
          <div className="sd-vocab-list" role="listbox" aria-label={`${view === 'due' ? 'Due' : 'All'} student words`}>
            {visibleWords.map((word) => (
              <button
                key={word.id}
                className={`sd-vocab-row${selectedId === word.id ? ' active' : ''}`}
                onClick={() => setSelectedId(word.id)}
                role="option"
                aria-selected={selectedId === word.id}
              >
                <span className="sd-vocab-row-copy">
                  <strong>{word.word}</strong>
                  <small>{word.translation || 'No translation'}</small>
                </span>
                {word.part_of_speech && <span className="sd-vocab-pos">{word.part_of_speech}</span>}
                <span className={`sd-vocab-due${isDueNow(word) ? ' due' : ''}`}>{reviewLabel(word)}</span>
              </button>
            ))}
            {visibleCount < filteredWords.length && (
              <button
                className="sd-vocab-show-more"
                onClick={() => setVisibleCount((count) => count + STUDENT_WORD_BATCH)}
              >
                Show 100 more
              </button>
            )}
          </div>

          {selectedWord && (
            <article className="sd-vocab-detail">
              <div className="sd-vocab-detail-header">
                <div>
                  <div className="sd-vocab-heading-row">
                    <h3>{selectedWord.word}</h3>
                    {selectedWord.part_of_speech && <span className="sd-vocab-pos">{selectedWord.part_of_speech}</span>}
                  </div>
                  <p>{selectedWord.translation || 'No translation'}</p>
                </div>
                <span className={`sd-vocab-due sd-vocab-due--large${isDueNow(selectedWord) ? ' due' : ''}`}>
                  {reviewLabel(selectedWord)}
                </span>
              </div>

              {selectedWord.image_url && (
                <div className="sd-vocab-image">
                  <img src={api.proxyImageUrl(selectedWord.image_url) ?? undefined} alt="" />
                </div>
              )}

              <div className="sd-vocab-detail-grid">
                <div className="sd-vocab-detail-card">
                  <span>Definition</span>
                  <p>{selectedWord.definition || selectedWord.translation || 'No definition saved.'}</p>
                </div>
                <div className="sd-vocab-detail-card">
                  <span>Study progress</span>
                  <p className="sd-vocab-stage-line">
                    <b className={`sd-word-stage sd-word-stage--${selectedWord.srs_stage}`}>{selectedWord.srs_stage}</b>
                    {accuracy === null ? 'Not reviewed yet' : `${accuracy}% accuracy · ${totalAnswers} answers`}
                  </p>
                </div>
                {selectedWord.sentence_context && (
                  <div className="sd-vocab-detail-card">
                    <span>Saved from</span>
                    <p><i>{selectedWord.sentence_context}</i></p>
                  </div>
                )}
                {selectedWord.example_sentence && (
                  <div className="sd-vocab-detail-card">
                    <span>Example</span>
                    <p><i>{selectedWord.example_sentence}</i></p>
                  </div>
                )}
                <div className="sd-vocab-detail-card">
                  <span>Frequency</span>
                  <p>
                    {selectedWord.frequency == null ? 'Unranked' : `${selectedWord.frequency}/10`}
                    {selectedWord.lemma_frequency_rank ? ` · corpus rank #${selectedWord.lemma_frequency_rank.toLocaleString()}` : ''}
                  </p>
                </div>
                <div className="sd-vocab-detail-card">
                  <span>History</span>
                  <p>
                    Added {formatShortDate(selectedWord.created_at)}
                    {selectedWord.last_reviewed_at ? ` · reviewed ${relativeTime(selectedWord.last_reviewed_at)}` : ''}
                  </p>
                </div>
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recent sessions timeline
// ---------------------------------------------------------------------------

function SessionTimeline({ sessions }: { sessions: RecentSession[] }) {
  if (sessions.length === 0) return <p className="sd-empty">No completed sessions yet.</p>;
  return (
    <div className="sd-sessions">
      {sessions.map((s) => {
        const info = SESSION_LABELS[s.type];
        const score = s.questionCount > 0 ? Math.round((s.correctCount / s.questionCount) * 100) : 0;
        return (
          <div key={`${s.type}-${s.id}`} className="sd-session-row">
            <span className="sd-session-badge" style={{ background: info.color }}>{info.label}</span>
            <div className="sd-session-info">
              <span className="sd-session-score">{score}%</span>
              <span className="sd-session-detail">
                {s.correctCount}/{s.questionCount}
                {s.durationSeconds ? ` in ${formatDuration(s.durationSeconds)}` : ''}
              </span>
            </div>
            <span className="sd-session-time">{relativeTime(s.doneAt)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function StudentDetail() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const classroomId = searchParams.get('classroomId');

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dashboardView, setDashboardView] = useState<'words' | 'progress'>('words');

  const { data, loading, error } = useAsyncData<StudentDetailData>(
    () => {
      if (!studentId) return Promise.reject(new Error('Missing student ID'));
      if (!classroomId) return Promise.reject(new Error('A classroom context is required to view student details.'));
      return api.getStudentStats(classroomId, studentId);
    },
    [classroomId, studentId],
  );

  if (loading) return <div className="loading-screen"><div className="loading-spinner" /></div>;

  if (error) {
    return (
      <div className="sd-page">
        <button className="sd-back" onClick={() => navigate(classroomId ? `/students?classroomId=${classroomId}` : '/students')}>
          <ChevronLeftIcon size={16} /> Back
        </button>
        <div className="auth-error">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { student, stats, activity, recentSessions, wordLists, words } = data;
  const displayName = student.display_name || student.username;
  const completedLists = wordLists.filter((wl) => wl.completed).length;

  return (
    <div className="sd-page">
      {/* Header */}
      <button className="sd-back" onClick={() => navigate(classroomId ? `/students?classroomId=${classroomId}` : '/students')}>
        <ChevronLeftIcon size={16} /> Back
      </button>

      <div className="sd-profile">
        <div className="sd-avatar">{displayName.charAt(0).toUpperCase()}</div>
        <div>
          <h1 className="sd-name">{displayName}</h1>
          <span className="sd-username">@{student.username}</span>
        </div>
      </div>

      {/* Key metrics */}
      <div className="sd-metrics">
        <div className="sd-metric">
          <span className="sd-metric-value sd-metric-value--accent">{stats.streak}</span>
          <span className="sd-metric-label">Day streak</span>
        </div>
        <div className="sd-metric">
          <span className="sd-metric-value">{stats.totalWords}</span>
          <span className="sd-metric-label">Total words</span>
        </div>
        <div className="sd-metric">
          <span className="sd-metric-value">{stats.wordsMastered}</span>
          <span className="sd-metric-label">Mastered</span>
        </div>
        <div className="sd-metric">
          <span className="sd-metric-value">{pct(stats.accuracy)}</span>
          <span className="sd-metric-label">Accuracy</span>
        </div>
        <div className="sd-metric">
          <span className="sd-metric-value">{stats.wordsDue}</span>
          <span className="sd-metric-label">Due now</span>
        </div>
      </div>
      {stats.reviewHistoryPartial && (
        <div className="sd-history-notice" role="status">
          Detailed review history is exact from{' '}
          {stats.reviewHistoryAccurateFrom ? formatShortDate(stats.reviewHistoryAccurateFrom) : 'this update'} onward.
          Earlier dates can show only each word&apos;s latest recorded review.
        </div>
      )}

      <div className="sd-dashboard-tabs" role="tablist" aria-label="Student dashboard section">
        <button
          role="tab"
          aria-selected={dashboardView === 'words'}
          className={dashboardView === 'words' ? 'active' : ''}
          onClick={() => setDashboardView('words')}
        >
          Words
          <span>{words.filter(isDueToday).length} due today</span>
        </button>
        <button
          role="tab"
          aria-selected={dashboardView === 'progress'}
          className={dashboardView === 'progress' ? 'active' : ''}
          onClick={() => setDashboardView('progress')}
        >
          Progress
        </button>
      </div>

      {dashboardView === 'words' ? (
        <StudentVocabularyPanel words={words} />
      ) : (
      <div className="sd-grid" role="tabpanel" aria-label="Student progress">
        {/* Left column */}
        <div className="sd-col">
          {/* 30-day calendar */}
          <div className="sd-card">
            <h2 className="sd-card-title">Last 30 Days</h2>
            <MonthCalendar activity={activity} accountCreated={student.created_at} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
            {selectedDay && <DayOverlay day={selectedDay} activity={activity} onClose={() => setSelectedDay(null)} />}
          </div>

        </div>

        {/* Right column */}
        <div className="sd-col">
          {/* Recent sessions */}
          <div className="sd-card">
            <h2 className="sd-card-title">Recent Tests & Practice</h2>
            <SessionTimeline sessions={recentSessions} />
          </div>

          {/* Word lists */}
          <div className="sd-card">
            <div className="sd-card-title-row">
              <h2 className="sd-card-title">Assignments</h2>
              {wordLists.length > 0 && (
                <span className="sd-card-badge">{completedLists}/{wordLists.length}</span>
              )}
            </div>
            {wordLists.length === 0 ? (
              <p className="sd-empty">No assignments yet.</p>
            ) : (
              <div className="sd-wl-list">
                {wordLists.map((wl) => (
                  <div key={wl.id} className={`sd-wl-row${wl.completed ? ' sd-wl-row--done' : ''}`}>
                    <div className="sd-wl-icon">
                      {wl.completed ? <CheckIcon size={14} strokeWidth={2.5} /> : <span className="sd-wl-circle" />}
                    </div>
                    <div className="sd-wl-info">
                      <span className="sd-wl-title">{wl.title || 'Word List'}</span>
                      <span className="sd-wl-meta">
                        {wl.word_count} word{wl.word_count !== 1 ? 's' : ''}
                        {wl.completed_at ? ` -- completed ${formatShortDate(wl.completed_at)}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 90-day summary */}
          <div className="sd-card">
            <h2 className="sd-card-title">90-Day Summary</h2>
            <div className="sd-summary-list">
              <div className="sd-summary-row">
                <span className="sd-summary-label">Reviews</span>
                <span className="sd-summary-value">{activity.reduce((s, a) => s + a.reviews, 0)}</span>
              </div>
              <div className="sd-summary-row">
                <span className="sd-summary-label">Words added</span>
                <span className="sd-summary-value">{activity.reduce((s, a) => s + a.wordsAdded, 0)}</span>
              </div>
              <div className="sd-summary-row">
                <span className="sd-summary-label">Practice sessions</span>
                <span className="sd-summary-value">{activity.reduce((s, a) => s + a.practiceSessions, 0)}</span>
              </div>
              <div className="sd-summary-row">
                <span className="sd-summary-label">Drills</span>
                <span className="sd-summary-value">{activity.reduce((s, a) => s + a.drills, 0)}</span>
              </div>
              <div className="sd-summary-row">
                <span className="sd-summary-label">Voice practice</span>
                <span className="sd-summary-value">{activity.reduce((s, a) => s + a.voiceSessions, 0)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
