// ---------------------------------------------------------------------------
// components/classwork/LessonTab.tsx — Lesson post creation tab
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { LessonItem } from '../../api';
import AttachmentEditor from '../AttachmentEditor';
import { toErrorMessage } from '../../utils/errors';

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

export default function LessonTab({
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
      setError(toErrorMessage(err));
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
