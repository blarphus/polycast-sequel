// ---------------------------------------------------------------------------
// components/classwork/ClassSessionTab.tsx — Class session creation tab
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import type { Recurrence } from '../../api';
import { DAY_LABELS, DAY_VALUES } from './languages';
import { toErrorMessage } from '../../utils/errors';

export default function ClassSessionTab({
  onSubmit,
}: {
  onSubmit: (data: {
    title: string;
    body?: string;
    scheduled_at?: string;
    duration_minutes?: number;
    recurrence?: Recurrence | null;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('14:00');
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [untilDate, setUntilDate] = useState('');
  const [duration, setDuration] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const toggleDay = (day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  };

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    if (!isRecurring && !date) { setError('Date is required for one-off sessions'); return; }
    if (isRecurring && selectedDays.length === 0) { setError('Select at least one day'); return; }

    setSubmitting(true);
    setError('');
    try {
      if (isRecurring) {
        await onSubmit({
          title,
          body: body || undefined,
          scheduled_at: new Date().toISOString(),
          duration_minutes: duration || undefined,
          recurrence: { days: selectedDays, time, until: untilDate || '2099-12-31' },
        });
      } else {
        const scheduledAt = new Date(`${date}T${time}`).toISOString();
        await onSubmit({
          title,
          body: body || undefined,
          scheduled_at: scheduledAt,
          duration_minutes: duration || undefined,
          recurrence: null,
        });
      }
    } catch (err: any) {
      console.error('Create class session failed:', err);
      setError(toErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-post-tab-content">
      {error && <div className="auth-error">{error}</div>}

      <label className="form-label">Title</label>
      <input
        className="form-input"
        placeholder="e.g. Conversation Practice"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div className="class-session-toggle">
        <button
          className={`class-session-toggle-btn${!isRecurring ? ' active' : ''}`}
          onClick={() => setIsRecurring(false)}
        >
          One-off
        </button>
        <button
          className={`class-session-toggle-btn${isRecurring ? ' active' : ''}`}
          onClick={() => setIsRecurring(true)}
        >
          Recurring
        </button>
      </div>

      {!isRecurring ? (
        <>
          <label className="form-label">Date</label>
          <input
            className="form-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <label className="form-label">Time</label>
          <input
            className="form-input"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </>
      ) : (
        <>
          <label className="form-label">Days of the week</label>
          <div className="class-session-days">
            {DAY_VALUES.map((day, i) => (
              <button
                key={day}
                className={`class-session-day-btn${selectedDays.includes(day) ? ' active' : ''}`}
                onClick={() => toggleDay(day)}
              >
                {DAY_LABELS[i]}
              </button>
            ))}
          </div>
          <label className="form-label">Time</label>
          <input
            className="form-input"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <label className="form-label">End date (optional)</label>
          <input
            className="form-input"
            type="date"
            value={untilDate}
            onChange={(e) => setUntilDate(e.target.value)}
          />
        </>
      )}

      <label className="form-label">Duration (minutes)</label>
      <input
        className="form-input"
        type="number"
        min={5}
        max={180}
        value={duration}
        onChange={(e) => setDuration(parseInt(e.target.value) || 30)}
      />

      <label className="form-label">Description (optional)</label>
      <textarea
        className="form-input stream-textarea"
        placeholder="What will you cover in this class?"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
      />

      <button
        className="btn btn-primary btn-block"
        disabled={submitting}
        onClick={handleSubmit}
        style={{ marginTop: '1.25rem' }}
      >
        {submitting ? 'Scheduling…' : 'Schedule Class'}
      </button>
    </div>
  );
}
