// ---------------------------------------------------------------------------
// components/classwork/ClassSessionCard.tsx — Class session post cards
// ---------------------------------------------------------------------------

import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { StreamPost, Recurrence } from '../../api';
import { DAY_LABELS } from './languages';
import { CalendarIcon } from '../icons';
import { formatLocalDate, formatUsDateTime } from '../../utils/dateFormat';

export { CalendarIcon } from '../icons';

const DAY_NAMES = ['', ...DAY_LABELS];

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
  return formatUsDateTime(dateStr);
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
          <CalendarIcon />
          Class Session
        </span>
        <span className="stream-post-date">{formatLocalDate(post.created_at)}</span>
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
          <CalendarIcon />
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
