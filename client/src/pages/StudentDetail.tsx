// ---------------------------------------------------------------------------
// pages/StudentDetail.tsx -- Read-only view of a student's dictionary & stats
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import type { StudentDetail as StudentDetailData, DailyActivity } from '../api';
import { ChevronLeftIcon, CheckIcon } from '../components/icons';
import { formatDate as formatShortDate } from '../utils/dateFormat';
import { useAsyncData } from '../hooks/useAsyncData';
import Avatar from '../components/Avatar';

// ---------------------------------------------------------------------------
// Activity heatmap calendar (last 90 days)
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

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

  // Build 13 weeks (91 days) ending today
  const today = new Date();
  const cells: { date: string; weekday: number; weekIndex: number }[] = [];
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 90);
  // Align to start of week (Sunday)
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const d = new Date(startDate);
  let weekIndex = 0;
  while (d <= today) {
    cells.push({
      date: d.toISOString().slice(0, 10),
      weekday: d.getDay(),
      weekIndex,
    });
    if (d.getDay() === 6) weekIndex++;
    d.setDate(d.getDate() + 1);
  }

  const totalWeeks = weekIndex + 1;

  // Month labels
  const monthLabels: { label: string; weekIndex: number }[] = [];
  let lastMonth = -1;
  for (const cell of cells) {
    const month = new Date(cell.date).getMonth();
    if (month !== lastMonth && cell.weekday === 0) {
      monthLabels.push({
        label: new Date(cell.date).toLocaleString('en-US', { month: 'short' }),
        weekIndex: cell.weekIndex,
      });
      lastMonth = month;
    }
  }

  const cellSize = 13;
  const cellGap = 2;
  const step = cellSize + cellGap;
  const labelWidth = 28;

  return (
    <div className="activity-calendar">
      <svg
        width={labelWidth + totalWeeks * step + 2}
        height={20 + 7 * step + 2}
        className="activity-calendar-svg"
      >
        {/* Month labels */}
        {monthLabels.map((m, i) => (
          <text
            key={i}
            x={labelWidth + m.weekIndex * step}
            y={12}
            className="activity-calendar-month"
          >
            {m.label}
          </text>
        ))}
        {/* Weekday labels */}
        {WEEKDAY_LABELS.map((label, i) => (
          label ? (
            <text
              key={i}
              x={labelWidth - 4}
              y={20 + i * step + cellSize - 2}
              className="activity-calendar-weekday"
              textAnchor="end"
            >
              {label}
            </text>
          ) : null
        ))}
        {/* Cells */}
        {cells.map((cell) => {
          const data = activityMap.get(cell.date);
          const count = data ? totalActivity(data) : 0;
          const level = activityLevel(count);
          const isFuture = cell.date > today.toISOString().slice(0, 10);
          return (
            <rect
              key={cell.date}
              x={labelWidth + cell.weekIndex * step}
              y={20 + cell.weekday * step}
              width={cellSize}
              height={cellSize}
              rx={2}
              className={`activity-cell activity-cell--${isFuture ? 'future' : level}`}
              onMouseEnter={(e) => {
                if (!isFuture && count > 0) {
                  setTooltip({ day: cell.date, data: data!, x: e.clientX, y: e.clientY });
                }
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
      </svg>
      {tooltip && (
        <div
          className="activity-tooltip"
          style={{ top: tooltip.y - 60, left: tooltip.x - 80 }}
        >
          <strong>{new Date(tooltip.day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
          <div>{tooltip.data.reviews} reviews</div>
          {tooltip.data.wordsAdded > 0 && <div>{tooltip.data.wordsAdded} words added</div>}
          {tooltip.data.quizzes > 0 && <div>{tooltip.data.quizzes} quizzes ({tooltip.data.quizCorrect}/{tooltip.data.quizTotal})</div>}
          {tooltip.data.drills > 0 && <div>{tooltip.data.drills} drills</div>}
          {tooltip.data.voiceSessions > 0 && <div>{tooltip.data.voiceSessions} voice sessions</div>}
        </div>
      )}
    </div>
  );
}

const SRS_STAGES = [
  { key: 'new', label: 'New', className: 'srs-dot--new' },
  { key: 'learning', label: 'Learning', className: 'srs-dot--learning' },
  { key: 'review', label: 'Review', className: 'srs-dot--review' },
  { key: 'mastered', label: 'Mastered', className: 'srs-dot--mastered' },
] as const;

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
      <div className="student-detail-page">
        <button className="btn btn-back" onClick={() => navigate(classroomId ? `/students?classroomId=${classroomId}` : '/students')}>Back</button>
        <div className="auth-error">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { student, stats, activity, wordLists, words } = data;

  const formatAccuracy = (acc: number | null) => {
    if (acc === null) return '--';
    return `${Math.round(acc * 100)}%`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return formatShortDate(dateStr);
  };

  return (
    <div className="student-detail-page">
      <button className="btn btn-back" onClick={() => navigate(classroomId ? `/students?classroomId=${classroomId}` : '/students')}>
        <ChevronLeftIcon size={18} />
        Back
      </button>

      {/* Student header */}
      <div className="student-detail-header">
        <Avatar name={student.display_name || student.username} className="student-detail-avatar" />
        <div>
          <h1 className="student-detail-name">{student.display_name || student.username}</h1>
          <span className="student-detail-username">@{student.username}</span>
        </div>
      </div>

      {/* Stats grid -- Row 1 */}
      <div className="student-stats-grid">
        <div className="student-stat-card">
          <span className="student-stat-value">{stats.totalWords}</span>
          <span className="student-stat-label">Total words</span>
        </div>
        <div className="student-stat-card">
          <span className="student-stat-value">{stats.wordsLearned}</span>
          <span className="student-stat-label">Learned</span>
        </div>
        <div className="student-stat-card">
          <span className="student-stat-value">{stats.wordsMastered}</span>
          <span className="student-stat-label">Mastered</span>
        </div>
        <div className="student-stat-card">
          <span className="student-stat-value">{formatAccuracy(stats.accuracy)}</span>
          <span className="student-stat-label">Accuracy</span>
        </div>
      </div>

      {/* Stats grid -- Row 2 */}
      <div className="student-stats-grid">
        <div className="student-stat-card">
          <span className="student-stat-value">{stats.wordsDue}</span>
          <span className="student-stat-label">Due</span>
        </div>
        <div className="student-stat-card">
          <span className="student-stat-value">{stats.wordsInLearning}</span>
          <span className="student-stat-label">In learning</span>
        </div>
        <div className="student-stat-card">
          <span className="student-stat-value">{stats.wordsNew}</span>
          <span className="student-stat-label">New</span>
        </div>
        <div className="student-stat-card">
          <span className="student-stat-value">{stats.daysActiveThisWeek}/7</span>
          <span className="student-stat-label">Days active</span>
        </div>
        <div className="student-stat-card">
          <span className="student-stat-value">{stats.streak}</span>
          <span className="student-stat-label">Day streak</span>
        </div>
      </div>

      {/* Activity calendar */}
      <h2 className="student-detail-section-title" style={{ marginTop: '1.5rem' }}>Activity</h2>
      {activity.length === 0 ? (
        <p className="students-empty">No activity yet.</p>
      ) : (
        <ActivityCalendar activity={activity} />
      )}

      {/* Assigned Word Lists */}
      {wordLists && wordLists.length > 0 && (
        <>
          <h2 className="student-detail-section-title">Assigned Word Lists ({wordLists.length})</h2>
          <div className="student-wordlist-section">
            {wordLists.map((wl) => (
              <div key={wl.id} className="student-wordlist-row">
                <div className="student-wordlist-info">
                  <span className="student-wordlist-title">{wl.title || 'Word List'}</span>
                  <span className="student-wordlist-count">{wl.word_count} words</span>
                </div>
                {wl.completed ? (
                  <span className="student-wordlist-status student-wordlist-status--completed">
                    <CheckIcon size={14} strokeWidth={2.5} />
                    Completed {wl.completed_at ? formatShortDate(wl.completed_at) : ''}
                  </span>
                ) : (
                  <span className="student-wordlist-status student-wordlist-status--incomplete">
                    Not completed
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Dictionary */}
      <h2 className="student-detail-section-title" style={{ marginTop: '1.5rem' }}>Dictionary ({words.length})</h2>
      {words.length === 0 ? (
        <p className="students-empty">No words saved yet.</p>
      ) : (
        <>
          <div className="srs-legend">
            {SRS_STAGES.map((s) => (
              <span key={s.key} className="srs-legend-item">
                <span className={`srs-dot ${s.className}`} />
                {s.label}
              </span>
            ))}
          </div>
          <div className="student-word-list">
            {words.map((w) => (
              <div key={w.id} className="student-word-row">
                <span className={`srs-dot srs-dot--${w.srs_stage}`} />
                <span className="student-word-term">{w.word}</span>
                <span className="student-word-translation">{w.translation}</span>
                {w.part_of_speech && <span className="student-word-pos">{w.part_of_speech}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
