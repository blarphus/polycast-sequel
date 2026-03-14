// ---------------------------------------------------------------------------
// pages/StudentDetail.tsx -- Teacher view of a student's progress & stats
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import type { StudentDetail as StudentDetailData, DailyActivity, RecentSession } from '../api';
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

const SESSION_LABELS: Record<string, { label: string; color: string }> = {
  quiz: { label: 'Quiz', color: '#6366f1' },
  drill: { label: 'Drill', color: '#f59e0b' },
  voice: { label: 'Voice', color: '#06b6d4' },
};

// ---------------------------------------------------------------------------
// 30-day heatmap calendar with clickable day detail
// ---------------------------------------------------------------------------

function totalActivity(d: DailyActivity): number {
  return d.reviews + d.wordsAdded + d.quizzes + d.drills + d.voiceSessions;
}

// Returns a status for the day:
// 'completed' — reviewed cards (did their SRS work)
// 'partial'   — did other activity (quizzes, drills, etc.) but no reviews
// 'skipped'   — no activity at all
// 'none'      — day hasn't happened yet or no data
function dayStatus(d: DailyActivity | undefined): 'completed' | 'partial' | 'skipped' | 'none' {
  if (!d) return 'skipped';
  if (d.reviews > 0) return 'completed';
  if (totalActivity(d) > 0) return 'partial';
  return 'skipped';
}

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function MonthCalendar({ activity, selectedDay, onSelectDay }: {
  activity: DailyActivity[];
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}) {
  const activityMap = new Map(activity.map((d) => [d.day, d]));
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Build 30 days ending today
  type Cell = { date: string; day: number; status: ReturnType<typeof dayStatus> } | null;
  const days: { date: string; weekday: number; day: number; status: ReturnType<typeof dayStatus> }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const data = activityMap.get(dateStr);
    days.push({ date: dateStr, weekday: d.getDay(), day: d.getDate(), status: dayStatus(data) });
  }

  // Group into rows of 7 (Sun=0 .. Sat=6)
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
            const isSelected = selectedDay === cell.date;
            const isToday = cell.date === todayStr;
            return (
              <button
                key={ci}
                className={`sd-heatmap-cell sd-heatmap-cell--${cell.status}${isSelected ? ' sd-heatmap-cell--selected' : ''}${isToday ? ' sd-heatmap-cell--today' : ''}`}
                onClick={() => onSelectDay(isSelected ? null : cell.date)}
              >
                <span className="sd-heatmap-date">{cell.day}</span>
              </button>
            );
          })}
        </div>
      ))}
      <div className="sd-heatmap-legend">
        <span className="sd-heatmap-legend-cell sd-heatmap-cell--completed" />
        <span className="sd-heatmap-legend-label">Reviewed</span>
        <span className="sd-heatmap-legend-cell sd-heatmap-cell--partial" />
        <span className="sd-heatmap-legend-label">Some activity</span>
        <span className="sd-heatmap-legend-cell sd-heatmap-cell--skipped" />
        <span className="sd-heatmap-legend-label">Skipped</span>
      </div>
    </div>
  );
}

function DayDetail({ day, activity }: { day: string; activity: DailyActivity[] }) {
  const data = activity.find((a) => a.day === day);
  const dateLabel = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  if (!data || totalActivity(data) === 0) {
    return (
      <div className="sd-day-detail">
        <h3 className="sd-day-detail-title">{dateLabel}</h3>
        <p className="sd-empty">No activity on this day.</p>
      </div>
    );
  }

  const reviewed = data.words.filter((w) => w.action === 'reviewed');
  const added = data.words.filter((w) => w.action === 'added');
  // Deduplicate reviewed words (same word can appear multiple times)
  const uniqueReviewed = [...new Map(reviewed.map((w) => [w.word, w])).values()];

  return (
    <div className="sd-day-detail">
      <h3 className="sd-day-detail-title">{dateLabel}</h3>

      <div className="sd-day-stats">
        {data.reviews > 0 && <span className="sd-day-stat">{data.reviews} reviews</span>}
        {data.wordsAdded > 0 && <span className="sd-day-stat">{data.wordsAdded} words added</span>}
        {data.quizzes > 0 && <span className="sd-day-stat">{data.quizzes} quiz{data.quizzes > 1 ? 'zes' : ''} ({data.quizCorrect}/{data.quizTotal})</span>}
        {data.drills > 0 && <span className="sd-day-stat">{data.drills} drill{data.drills > 1 ? 's' : ''}</span>}
        {data.voiceSessions > 0 && <span className="sd-day-stat">{data.voiceSessions} voice session{data.voiceSessions > 1 ? 's' : ''}</span>}
      </div>

      {uniqueReviewed.length > 0 && (
        <div className="sd-day-words">
          <h4 className="sd-day-words-title">Words reviewed ({uniqueReviewed.length})</h4>
          <div className="sd-day-word-list">
            {uniqueReviewed.map((w, i) => (
              <div key={i} className="sd-day-word-row">
                <span className="sd-day-word-term">{w.word}</span>
                <span className="sd-day-word-translation">{w.translation}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {added.length > 0 && (
        <div className="sd-day-words">
          <h4 className="sd-day-words-title">Words added ({added.length})</h4>
          <div className="sd-day-word-list">
            {added.map((w, i) => (
              <div key={i} className="sd-day-word-row">
                <span className="sd-day-word-term">{w.word}</span>
                <span className="sd-day-word-translation">{w.translation}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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

      {/* Two-column layout */}
      <div className="sd-grid">
        {/* Left column */}
        <div className="sd-col">
          {/* 30-day calendar */}
          <div className="sd-card">
            <h2 className="sd-card-title">Last 30 Days</h2>
            <MonthCalendar activity={activity} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
            {selectedDay && <DayDetail day={selectedDay} activity={activity} />}
          </div>

          {/* Vocabulary */}
          <div className="sd-card">
            <h2 className="sd-card-title">Vocabulary ({words.length})</h2>
            {words.length === 0 ? (
              <p className="sd-empty">No words saved yet.</p>
            ) : (
              <>
                <SrsProgressBar words={words} />
                <div className="sd-word-table">
                  <div className="sd-word-table-header">
                    <span>Word</span>
                    <span>Translation</span>
                    <span>Stage</span>
                  </div>
                  {words.slice(0, 20).map((w) => (
                    <div key={w.id} className="sd-word-row">
                      <span className="sd-word-term">{w.word}</span>
                      <span className="sd-word-translation">{w.translation}</span>
                      <span className={`sd-word-stage sd-word-stage--${w.srs_stage}`}>{w.srs_stage}</span>
                    </div>
                  ))}
                  {words.length > 20 && (
                    <div className="sd-word-row sd-word-more">+{words.length - 20} more words</div>
                  )}
                </div>
              </>
            )}
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
                <span className="sd-summary-label">Quizzes</span>
                <span className="sd-summary-value">{activity.reduce((s, a) => s + a.quizzes, 0)}</span>
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
    </div>
  );
}
