// ---------------------------------------------------------------------------
// components/classwork/ClassSessionCard.tsx — Class session post cards
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StreamPost, Recurrence } from '../../api';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatRecurrence(rec: Recurrence): string {
  const dayStr = rec.days.map((d) => DAY_NAMES[d]).join(', ');
  const timeParts = rec.time.split(':');
  const h = parseInt(timeParts[0]);
  const m = timeParts[1];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `Every ${dayStr} at ${h12}:${m} ${ampm}`;
}

function formatScheduledAt(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isJoinable(post: StreamPost): boolean {
  // Joinable 5 minutes before scheduled time
  const now = Date.now();
  if (post.recurrence) {
    const rec = post.recurrence;
    const [h, m] = rec.time.split(':').map(Number);
    const today = new Date();
    today.setHours(h, m, 0, 0);
    return now >= today.getTime() - 5 * 60 * 1000;
  }
  if (post.scheduled_at) {
    const scheduled = new Date(post.scheduled_at).getTime();
    return now >= scheduled - 5 * 60 * 1000;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Teacher card
// ---------------------------------------------------------------------------

export function TeacherClassSessionCard({ post }: { post: StreamPost }) {
  const navigate = useNavigate();

  return (
    <div className="stream-post-card class-session-card">
      <div className="stream-post-header">
        <span className="stream-post-type-badge stream-post-type-badge--class">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Class Session
        </span>
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>

      {post.title && <h3 className="stream-post-title">{post.title}</h3>}

      <div className="class-session-details">
        {post.recurrence ? (
          <span className="class-session-schedule">{formatRecurrence(post.recurrence)}</span>
        ) : post.scheduled_at ? (
          <span className="class-session-schedule">{formatScheduledAt(post.scheduled_at)}</span>
        ) : null}
        {post.duration_minutes && (
          <span className="class-session-duration">{post.duration_minutes} min</span>
        )}
      </div>

      {post.body && <p className="stream-post-body">{post.body}</p>}

      <button
        className="btn btn-primary class-session-action-btn"
        onClick={() => navigate(`/group-call/${post.id}`)}
      >
        Start Class
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student card
// ---------------------------------------------------------------------------

export function StudentClassSessionCard({ post }: { post: StreamPost }) {
  const navigate = useNavigate();
  const joinable = isJoinable(post);

  return (
    <div className="stream-post-card class-session-card">
      <div className="stream-post-header">
        <span className="stream-post-type-badge stream-post-type-badge--class">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Class Session
        </span>
        {post.teacher_name && (
          <span className="stream-post-date">{post.teacher_name}</span>
        )}
      </div>

      {post.title && <h3 className="stream-post-title">{post.title}</h3>}

      <div className="class-session-details">
        {post.recurrence ? (
          <span className="class-session-schedule">{formatRecurrence(post.recurrence)}</span>
        ) : post.scheduled_at ? (
          <span className="class-session-schedule">{formatScheduledAt(post.scheduled_at)}</span>
        ) : null}
        {post.duration_minutes && (
          <span className="class-session-duration">{post.duration_minutes} min</span>
        )}
      </div>

      {post.body && <p className="stream-post-body">{post.body}</p>}

      <button
        className={`btn class-session-action-btn${joinable ? ' btn-primary' : ' btn-secondary'}`}
        disabled={!joinable}
        onClick={() => navigate(`/group-call/${post.id}`)}
      >
        {joinable ? 'Join Class' : 'Not yet'}
      </button>
    </div>
  );
}
