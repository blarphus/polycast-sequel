// ---------------------------------------------------------------------------
// pages/StudentDetail.tsx -- Read-only view of a student's dictionary & stats
// ---------------------------------------------------------------------------

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import type { StudentDetail as StudentDetailData } from '../api';
import { ChevronLeftIcon, CheckIcon } from '../components/icons';
import { formatDate as formatShortDate } from '../utils/dateFormat';

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
  const [data, setData] = useState<StudentDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!studentId) return;
    if (!classroomId) {
      setError('A classroom context is required to view student details.');
      setLoading(false);
      return;
    }
    api.getStudentStats(classroomId, studentId)
      .then(setData)
      .catch((err) => {
        console.error('Failed to load student stats:', err);
        setError(err instanceof Error ? err.message : 'Failed to load student data');
      })
      .finally(() => setLoading(false));
  }, [classroomId, studentId]);

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

  const { student, stats, wordLists, words } = data;

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
        <div className="student-detail-avatar">
          {(student.display_name || student.username).charAt(0).toUpperCase()}
        </div>
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
      </div>

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
