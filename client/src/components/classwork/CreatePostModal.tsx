// ---------------------------------------------------------------------------
// components/classwork/CreatePostModal.tsx — Create-post components
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useRef } from 'react';
import * as api from '../../api';
import type { StreamPost, StreamTopic, StreamAttachment, LessonItem, WordOverride, Recurrence } from '../../api';

import WordListTab from './WordListTab';

export { LANGUAGES } from './languages';

// ---------------------------------------------------------------------------
// Attachment editor (used by MaterialTab and LessonItemEditor)
// ---------------------------------------------------------------------------

export function AttachmentEditor({
  attachments,
  onChange,
}: {
  attachments: StreamAttachment[];
  onChange: (next: StreamAttachment[]) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');

  const add = () => {
    if (!url.trim()) return;
    onChange([...attachments, { url: url.trim(), label: label.trim() || url.trim() }]);
    setUrl('');
    setLabel('');
    setShowForm(false);
  };

  return (
    <div className="attachment-editor">
      {attachments.map((att, i) => (
        <div key={i} className="stream-attachment-row">
          <span className="stream-attachment-url">{att.label}</span>
          <button
            className="btn-small btn-danger"
            onClick={() => onChange(attachments.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      {showForm ? (
        <div className="stream-add-link-form">
          <input
            className="form-input"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
          <input
            className="form-input"
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="stream-add-link-row">
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={add}>
              Add Link
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(true)}>
          + Add Link
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MaterialTab
// ---------------------------------------------------------------------------

function MaterialTab({
  onSubmit,
}: {
  onSubmit: (data: { title: string; body: string; attachments: StreamAttachment[] }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<StreamAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!title.trim() && !body.trim() && attachments.length === 0) {
      setError('Add a title, body, or at least one link');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({ title, body, attachments });
    } catch (err: any) {
      console.error('Create material post failed:', err);
      setError(err instanceof Error ? err.message : String(err));
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
        placeholder="e.g. Watch this video about Spanish verbs"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="form-label">Body (optional)</label>
      <textarea
        className="form-input stream-textarea"
        placeholder="Add notes or instructions for your students…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
      />
      <label className="form-label">Links</label>
      <AttachmentEditor attachments={attachments} onChange={setAttachments} />
      <button
        className="btn btn-primary btn-block"
        disabled={submitting}
        onClick={handleSubmit}
        style={{ marginTop: '1.25rem' }}
      >
        {submitting ? 'Posting…' : 'Post Material'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LessonItemEditor + LessonTab
// ---------------------------------------------------------------------------

export function LessonItemEditor({
  item,
  index,
  onChange,
  onRemove,
  showRemove,
}: {
  item: LessonItem;
  index: number;
  onChange: (updated: LessonItem) => void;
  onRemove: () => void;
  showRemove: boolean;
}) {
  return (
    <div className="lesson-item-editor">
      <div className="lesson-item-editor-header">
        <span className="lesson-item-number">Item {index + 1}</span>
        {showRemove && (
          <button className="btn-small btn-danger" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      <label className="form-label">Title</label>
      <input
        className="form-input"
        placeholder={`e.g. Watch video ${index + 1}`}
        value={item.title}
        onChange={(e) => onChange({ ...item, title: e.target.value })}
      />
      <label className="form-label">Notes (optional)</label>
      <textarea
        className="form-input stream-textarea"
        placeholder="Instructions or context for this item…"
        value={item.body || ''}
        onChange={(e) => onChange({ ...item, body: e.target.value })}
        rows={3}
      />
      <label className="form-label">Links</label>
      <AttachmentEditor
        attachments={item.attachments}
        onChange={(atts) => onChange({ ...item, attachments: atts })}
      />
    </div>
  );
}

function LessonTab({
  onSubmit,
}: {
  onSubmit: (data: { title: string; lesson_items: LessonItem[] }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<LessonItem[]>([{ title: '', body: '', attachments: [] }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const updateItem = (i: number, updated: LessonItem) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? updated : it)));
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const addItem = () => setItems((prev) => [...prev, { title: '', body: '', attachments: [] }]);

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Lesson title is required'); return; }
    const validItems = items.filter((it) => it.title.trim() || (it.attachments && it.attachments.length > 0));
    if (validItems.length === 0) { setError('Add at least one item with a title or link'); return; }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({ title, lesson_items: validItems });
    } catch (err: any) {
      console.error('Create lesson post failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-post-tab-content">
      {error && <div className="auth-error">{error}</div>}
      <label className="form-label">Lesson Title</label>
      <input
        className="form-input"
        placeholder="e.g. Lesson 1: Introduction"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="lesson-items-list">
        {items.map((item, i) => (
          <LessonItemEditor
            key={i}
            item={item}
            index={i}
            onChange={(updated) => updateItem(i, updated)}
            onRemove={() => removeItem(i)}
            showRemove={items.length > 1}
          />
        ))}
      </div>
      <button className="btn btn-secondary btn-block" onClick={addItem} style={{ marginBottom: '1rem' }}>
        + Add Material Item
      </button>
      <button className="btn btn-primary btn-block" disabled={submitting} onClick={handleSubmit}>
        {submitting ? 'Posting…' : `Post Lesson (${items.length} item${items.length !== 1 ? 's' : ''})`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClassSessionTab
// ---------------------------------------------------------------------------

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_VALUES = [1, 2, 3, 4, 5, 6, 7]; // ISO weekdays

function ClassSessionTab({
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
      setError(err instanceof Error ? err.message : String(err));
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

// ---------------------------------------------------------------------------
// Create post modal (replaces /classwork/create navigation)
// ---------------------------------------------------------------------------

export function CreatePostModal({
  defaultTab,
  topics,
  user,
  onCreated,
  onClose,
  editingPost,
  onSaved,
}: {
  defaultTab: 'material' | 'lesson' | 'word_list' | 'class_session';
  topics: StreamTopic[];
  user: { native_language: string | null; target_language: string | null };
  onCreated: (post: StreamPost) => void;
  onClose: () => void;
  editingPost?: StreamPost | null;
  onSaved?: (updated: StreamPost) => void;
}) {
  const isEditMode = !!editingPost;
  const [tab, setTab] = useState<'material' | 'lesson' | 'word_list' | 'class_session'>(defaultTab);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(editingPost?.topic_id ?? null);

  const handleMaterialSubmit = async (data: { title: string; body: string; attachments: StreamAttachment[] }) => {
    const post = await api.createPost({ type: 'material', ...data, topic_id: selectedTopicId });
    onCreated(post);
  };

  const handleLessonSubmit = async (data: { title: string; lesson_items: LessonItem[] }) => {
    const post = await api.createPost({ type: 'lesson', ...data, topic_id: selectedTopicId });
    onCreated(post);
  };

  const handleClassSessionSubmit = async (data: { title: string; body?: string; scheduled_at?: string; duration_minutes?: number; recurrence?: Recurrence | null }) => {
    const post = await api.createPost({ type: 'class_session', ...data, topic_id: selectedTopicId });
    onCreated(post);
  };

  const handleWordListSubmit = async (data: { title: string; words: (string | WordOverride)[]; target_language: string }) => {
    const post = await api.createPost({ type: 'word_list', ...data, topic_id: selectedTopicId });
    onCreated(post);
  };

  const handleWordListEdit = async (data: { title: string; words: (string | WordOverride)[]; target_language: string }) => {
    if (!editingPost || !onSaved) return;
    const updated = await api.updatePost(editingPost.id, {
      title: data.title,
      words: data.words as WordOverride[],
      target_language: data.target_language,
      topic_id: selectedTopicId,
    });
    onSaved(updated);
  };

  return (
    <div className="stream-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stream-modal stream-create-modal">
        <div className="stream-create-modal-header">
          <h2 className="stream-modal-title">{isEditMode ? 'Edit Word List' : 'New Post'}</h2>
          <button className="stream-modal-close-btn" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {topics.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <label className="form-label">Topic (optional)</label>
            <select
              className="form-input"
              value={selectedTopicId || ''}
              onChange={(e) => setSelectedTopicId(e.target.value || null)}
            >
              <option value="">No Topic</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
        )}

        {!isEditMode && (
          <div className="create-post-tabs">
            <button className={`create-post-tab${tab === 'material' ? ' active' : ''}`} onClick={() => setTab('material')}>Material</button>
            <button className={`create-post-tab${tab === 'lesson' ? ' active' : ''}`} onClick={() => setTab('lesson')}>Lesson</button>
            <button className={`create-post-tab${tab === 'word_list' ? ' active' : ''}`} onClick={() => setTab('word_list')}>Word List</button>
            <button className={`create-post-tab${tab === 'class_session' ? ' active' : ''}`} onClick={() => setTab('class_session')}>Class</button>
          </div>
        )}

        {tab === 'material' && !isEditMode && <MaterialTab onSubmit={handleMaterialSubmit} />}
        {tab === 'lesson' && !isEditMode && <LessonTab onSubmit={handleLessonSubmit} />}
        {tab === 'class_session' && !isEditMode && <ClassSessionTab onSubmit={handleClassSessionSubmit} />}
        {tab === 'word_list' && (
          <WordListTab
            defaultTargetLang={user?.target_language || ''}
            nativeLang={user?.native_language || ''}
            onSubmit={isEditMode ? handleWordListEdit : handleWordListSubmit}
            initialData={editingPost ? {
              title: editingPost.title || '',
              words: editingPost.words || [],
              target_language: editingPost.target_language || '',
            } : undefined}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// + Create dropdown menu
// ---------------------------------------------------------------------------

export function CreateMenu({
  onSelect,
  onClose,
}: {
  onSelect: (type: 'material' | 'lesson' | 'word_list' | 'class_session' | 'topic') => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={menuRef} className="stream-create-dropdown">
      <button className="stream-create-menu-item" onClick={() => { onSelect('material'); onClose(); }}>
        <span className="stream-create-menu-icon">📄</span> Material
      </button>
      <button className="stream-create-menu-item" onClick={() => { onSelect('lesson'); onClose(); }}>
        <span className="stream-create-menu-icon">📚</span> Lesson
      </button>
      <button className="stream-create-menu-item" onClick={() => { onSelect('word_list'); onClose(); }}>
        <span className="stream-create-menu-icon">🔤</span> Word List
      </button>
      <button className="stream-create-menu-item" onClick={() => { onSelect('class_session'); onClose(); }}>
        <span className="stream-create-menu-icon">📅</span> Class Session
      </button>
      <div className="stream-create-menu-separator" />
      <button className="stream-create-menu-item" onClick={() => { onSelect('topic'); onClose(); }}>
        <span className="stream-create-menu-icon">＋</span> New Topic
      </button>
    </div>
  );
}
