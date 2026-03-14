// ---------------------------------------------------------------------------
// components/classwork/MaterialTab.tsx — Material post creation tab
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import type { StreamAttachment } from '../../api';
import AttachmentEditor from '../AttachmentEditor';
import { toErrorMessage } from '../../utils/errors';

export default function MaterialTab({
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
