import React, { useState } from 'react';
import type { StreamAttachment } from '../api';

interface AttachmentEditorProps {
  attachments: StreamAttachment[];
  onChange: (next: StreamAttachment[]) => void;
}

export default function AttachmentEditor({ attachments, onChange }: AttachmentEditorProps) {
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
