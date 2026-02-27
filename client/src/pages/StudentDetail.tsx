// ---------------------------------------------------------------------------
// pages/StudentDetail.tsx -- Read-only view of a student's dictionary & stats
// ---------------------------------------------------------------------------

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from '../api';
import type { StudentDetail as StudentDetailData } from '../api';

export default function StudentDetail() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<StudentDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!studentId) return;
    api.getStudentStats(studentId)
      .then(setData)
      .catch((err) => {
        console.error('Failed to load student stats:', err);
        setError(err instanceof Error ? err.message : 'Failed to load student data');
      })
      .finally(() => setLoading(false));
  }, [studentId]);

  if (loading) {
    return <div className="loading-screen"><div className="loading-spinner" /></div>;
  }

  if (error) {
    return (
      <div className="student-detail-page">
        <button className="btn btn-back" onClick={() => navigate('/students')}>Back</button>
        <div className="auth-error">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { student, stats, words } = data;

  const formatAccuracy = (acc: number | null) => {
    if (acc === null) return '--';
    return `${Math.round(acc * 100)}%`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="student-detail-page">
      <button className="btn btn-back" onClick={() => navigate('/students')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
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

      {/* Stats grid */}
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
          <span className="student-stat-value">{stats.wordsDue}</span>
          <span className="student-stat-label">Due</span>
        </div>
        <div className="student-stat-card">
          <span className="student-stat-value">{stats.wordsNew}</span>
          <span className="student-stat-label">New</span>
        </div>
        <div className="student-stat-card">
          <span className="student-stat-value">{stats.wordsInLearning}</span>
          <span className="student-stat-label">In learning</span>
        </div>
        <div className="student-stat-card">
          <span className="student-stat-value">{formatAccuracy(stats.accuracy)}</span>
          <span className="student-stat-label">Accuracy</span>
        </div>
        <div className="student-stat-card">
          <span className="student-stat-value">{stats.totalReviews}</span>
          <span className="student-stat-label">Total reviews</span>
        </div>
        <div className="student-stat-card">
          <span className="student-stat-value student-stat-value--small">{formatDate(stats.lastReviewedAt)}</span>
          <span className="student-stat-label">Last active</span>
        </div>
      </div>

      {/* Dictionary */}
      <h2 className="student-detail-section-title">Dictionary ({words.length})</h2>
      {words.length === 0 ? (
        <p className="students-empty">No words saved yet.</p>
      ) : (
        <div className="student-word-list">
          {words.map((w) => (
            <div key={w.id} className="student-word-row">
              <span className="student-word-term">{w.word}</span>
              <span className="student-word-translation">{w.translation}</span>
              {w.part_of_speech && <span className="student-word-pos">{w.part_of_speech}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
