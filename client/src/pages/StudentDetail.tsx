// ---------------------------------------------------------------------------
// pages/StudentDetail.tsx -- Teacher view of a student's progress & stats
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import type { StudentDetail as StudentDetailData, DailyActivity } from '../api';
import { ChevronLeftIcon, CheckIcon } from '../components/icons';
import { formatDate as formatShortDate } from '../utils/dateFormat';
import { useAsyncData } from '../hooks/useAsyncData';

// ---------------------------------------------------------------------------
// Activity heatmap calendar (last 90 days)
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ['', 'M', '', 'W', '', 'F', ''];

function totalActivity(d: DailyActivity): number {
  return d.reviews + d.wordsAdded + d.quizzes + d.drills + d.voiceSessions;
}

function activityLevel(count: number): number {
  if (count === 0) return 0;
  if (count <= 5) return 1;
  if (count <= 15) return 2;
  if (count <= 30) return 3;
  return 4;
}

function ActivityCalendar({ activity }: { activity: DailyActivity[] }) {
  const [tooltip, setTooltip] = useState<{ day: string; data: DailyActivity; x: number; y: number } | null>(null);
  const activityMap = new Map(activity.map((d) => [d.day, d]));

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const cells: { date: string; weekday: number; weekIndex: number }[] = [];
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 90);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const d = new Date(startDate);
  let weekIndex = 0;
  while (d <= today) {
    cells.push({ date: d.toISOString().slice(0, 10), weekday: d.getDay(), weekIndex });
    if (d.getDay() === 6) weekIndex++;
    d.setDate(d.getDate() + 1);
  }
  const totalWeeks = weekIndex + 1;

  const monthLabels: { label: string; weekIndex: number }[] = [];
  let lastMonth = -1;
  for (const cell of cells) {
    const month = new Date(cell.date).getMonth();
    if (month !== lastMonth && cell.weekday === 0) {
      monthLabels.push({ label: new Date(cell.date).toLocaleString('en-US', { month: 'short' }), weekIndex: cell.weekIndex });
      lastMonth = month;
    }
  }

  const cellSize = 12;
  const cellGap = 3;
  const step = cellSize + cellGap;
  const labelWidth = 20;

  return (
    <div className="sd-activity-calendar">
      <svg width={labelWidth + totalWeeks * step} height={16 + 7 * step}>
        {monthLabels.map((m, i) => (
          <text key={i} x={labelWidth + m.weekIndex * step} y={10} className="sd-cal-month">{m.label}</text>
        ))}
        {WEEKDAY_LABELS.map((label, i) => (
          label ? <text key={i} x={labelWidth - 3} y={16 + i * step + cellSize - 2} className="sd-cal-weekday" textAnchor="end">{label}</text> : null
        ))}
        {cells.map((cell) => {
          const data = activityMap.get(cell.date);
          const count = data ? totalActivity(data) : 0;
          const level = activityLevel(count);
          const isFuture = cell.date > todayStr;
          return (
            <rect
              key={cell.date}
              x={labelWidth + cell.weekIndex * step}
              y={16 + cell.weekday * step}
              width={cellSize}
              height={cellSize}
              rx={2}
              className={`sd-cal-cell sd-cal-cell--${isFuture ? 'future' : level}`}
              onMouseEnter={(e) => { if (!isFuture && count > 0) setTooltip({ day: cell.date, data: data!, x: e.clientX, y: e.clientY }); }}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
      </svg>
      {tooltip && (
        <div className="sd-cal-tooltip" style={{ top: tooltip.y - 70, left: tooltip.x - 90 }}>
          <strong>{new Date(tooltip.day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong>
          <span>{tooltip.data.reviews} reviews</span>
          {tooltip.data.wordsAdded > 0 && <span>{tooltip.data.wordsAdded} words added</span>}
          {tooltip.data.quizzes > 0 && <span>{tooltip.data.quizzes} quiz{tooltip.data.quizzes > 1 ? 'zes' : ''}</span>}
          {tooltip.data.drills > 0 && <span>{tooltip.data.drills} drill{tooltip.data.drills > 1 ? 's' : ''}</span>}
          {tooltip.data.voiceSessions > 0 && <span>{tooltip.data.voiceSessions} voice</span>}
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
          <div
            key={s.stage}
            className="sd-srs-bar-segment"
            style={{ width: `${(s.count / total) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.count}`}
          />
        ))}
      </div>
      <div className="sd-srs-legend">
        {segments.map((s) => (
          <span key={s.stage} className="sd-srs-legend-item">
            <span className="sd-srs-legend-dot" style={{ background: s.color }} />
            {s.label} ({s.count})
          </span>
        ))}
      </div>
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

  if (loading) {
    return <div className="loading-screen"><div className="loading-spinner" /></div>;
  }

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

  const { student, stats, activity, wordLists, words } = data;
  const displayName = student.display_name || student.username;
  const pct = (n: number | null) => n === null ? '--' : `${Math.round(n * 100)}%`;

  // Compute totals from activity data
  const totalReviewsLast90 = activity.reduce((s, a) => s + a.reviews, 0);
  const totalWordsAdded = activity.reduce((s, a) => s + a.wordsAdded, 0);
  const totalQuizzes = activity.reduce((s, a) => s + a.quizzes, 0);
  const totalDrills = activity.reduce((s, a) => s + a.drills, 0);
  const totalVoice = activity.reduce((s, a) => s + a.voiceSessions, 0);
  const completedLists = wordLists.filter((wl) => wl.completed).length;

  return (
    <div className="sd-page">
      {/* Header */}
      <div className="sd-header">
        <button className="sd-back" onClick={() => navigate(classroomId ? `/students?classroomId=${classroomId}` : '/students')}>
          <ChevronLeftIcon size={16} />
          Back
        </button>
        <div className="sd-profile">
          <div className="sd-avatar">{displayName.charAt(0).toUpperCase()}</div>
          <div>
            <h1 className="sd-name">{displayName}</h1>
            <span className="sd-username">@{student.username}</span>
          </div>
        </div>
      </div>

      {/* Key metrics row */}
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
          {/* Activity calendar card */}
          <div className="sd-card">
            <h2 className="sd-card-title">Activity</h2>
            {activity.length === 0 ? (
              <p className="sd-empty">No activity recorded yet.</p>
            ) : (
              <ActivityCalendar activity={activity} />
            )}
          </div>

          {/* SRS progress card */}
          <div className="sd-card">
            <h2 className="sd-card-title">Vocabulary Progress</h2>
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
                    <div className="sd-word-row sd-word-more">
                      +{words.length - 20} more words
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="sd-col">
          {/* 90-day summary card */}
          <div className="sd-card">
            <h2 className="sd-card-title">Last 90 Days</h2>
            <div className="sd-summary-list">
              <div className="sd-summary-row">
                <span className="sd-summary-label">Reviews completed</span>
                <span className="sd-summary-value">{totalReviewsLast90}</span>
              </div>
              <div className="sd-summary-row">
                <span className="sd-summary-label">Words added</span>
                <span className="sd-summary-value">{totalWordsAdded}</span>
              </div>
              <div className="sd-summary-row">
                <span className="sd-summary-label">Quizzes taken</span>
                <span className="sd-summary-value">{totalQuizzes}</span>
              </div>
              <div className="sd-summary-row">
                <span className="sd-summary-label">Drills completed</span>
                <span className="sd-summary-value">{totalDrills}</span>
              </div>
              <div className="sd-summary-row">
                <span className="sd-summary-label">Voice sessions</span>
                <span className="sd-summary-value">{totalVoice}</span>
              </div>
              <div className="sd-summary-row">
                <span className="sd-summary-label">Days active this week</span>
                <span className="sd-summary-value">{stats.daysActiveThisWeek}/7</span>
              </div>
            </div>
          </div>

          {/* Word lists card */}
          <div className="sd-card">
            <div className="sd-card-title-row">
              <h2 className="sd-card-title">Assigned Word Lists</h2>
              {wordLists.length > 0 && (
                <span className="sd-card-badge">{completedLists}/{wordLists.length}</span>
              )}
            </div>
            {wordLists.length === 0 ? (
              <p className="sd-empty">No word lists assigned.</p>
            ) : (
              <div className="sd-wl-list">
                {wordLists.map((wl) => (
                  <div key={wl.id} className={`sd-wl-row${wl.completed ? ' sd-wl-row--done' : ''}`}>
                    <div className="sd-wl-icon">
                      {wl.completed
                        ? <CheckIcon size={14} strokeWidth={2.5} />
                        : <span className="sd-wl-circle" />}
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
        </div>
      </div>
    </div>
  );
}
