// ---------------------------------------------------------------------------
// pages/StudentDetail.tsx -- Teacher view of a student's progress & stats
// ---------------------------------------------------------------------------

import React from 'react';
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
// Weekly activity bars (last 12 weeks)
// ---------------------------------------------------------------------------

function WeeklyActivityChart({ activity }: { activity: DailyActivity[] }) {
  // Aggregate by week
  const today = new Date();
  const weeks: { label: string; total: number; reviews: number; other: number }[] = [];

  for (let w = 11; w >= 0; w--) {
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() - w * 7);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);

    const startStr = weekStart.toISOString().slice(0, 10);
    const endStr = weekEnd.toISOString().slice(0, 10);

    let reviews = 0;
    let other = 0;
    for (const d of activity) {
      if (d.day >= startStr && d.day <= endStr) {
        reviews += d.reviews;
        other += d.wordsAdded + d.quizzes + d.drills + d.voiceSessions;
      }
    }

    const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    weeks.push({ label, total: reviews + other, reviews, other });
  }

  const maxVal = Math.max(...weeks.map((w) => w.total), 1);

  return (
    <div className="sd-weekly-chart">
      <div className="sd-weekly-bars">
        {weeks.map((w, i) => (
          <div key={i} className="sd-weekly-col" title={`${w.label}: ${w.total} activities`}>
            <div className="sd-weekly-bar-track">
              {w.total > 0 && (
                <div
                  className="sd-weekly-bar-fill"
                  style={{ height: `${Math.max((w.total / maxVal) * 100, 4)}%` }}
                />
              )}
            </div>
            {i % 3 === 0 && <span className="sd-weekly-label">{w.label}</span>}
          </div>
        ))}
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
          {/* Weekly activity */}
          <div className="sd-card">
            <h2 className="sd-card-title">Weekly Activity</h2>
            {activity.length === 0 ? (
              <p className="sd-empty">No activity yet.</p>
            ) : (
              <WeeklyActivityChart activity={activity} />
            )}
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
