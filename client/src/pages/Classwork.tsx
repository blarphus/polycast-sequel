// ---------------------------------------------------------------------------
// pages/Classwork.tsx — Class stream (Google Classroom-style)
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import * as api from '../api';
import type { StreamPost, StreamTopic, StreamPostWord, StreamAttachment, LessonItem, WordOverride } from '../api';
import ImagePicker from '../components/ImagePicker';
import WordLookupModal from '../components/WordLookupModal';
import { renderTildeHighlight } from '../utils/tildeMarkup';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' },
];

// ---------------------------------------------------------------------------
// Attachment editor (used by MaterialTab and LessonItemEditor)
// ---------------------------------------------------------------------------

function AttachmentEditor({
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

function LessonItemEditor({
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
// WordListTab
// ---------------------------------------------------------------------------

function WordListTab({
  defaultTargetLang,
  nativeLang,
  onSubmit,
}: {
  defaultTargetLang: string;
  nativeLang: string;
  onSubmit: (data: { title: string; words: (string | WordOverride)[]; target_language: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [targetLang, setTargetLang] = useState(defaultTargetLang);
  const [wordsText, setWordsText] = useState('');
  const [preview, setPreview] = useState<StreamPostWord[] | null>(null);
  const [lookedUp, setLookedUp] = useState(false);
  const [looking, setLooking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [imagePickerIdx, setImagePickerIdx] = useState<number | null>(null);
  const [defPickerIdx, setDefPickerIdx] = useState<number | null>(null);

  const wordLines = wordsText.split('\n').map((w) => w.trim()).filter(Boolean);

  const handleLookup = async () => {
    if (wordLines.length === 0) { setLookupError('Enter at least one word'); return; }
    if (!nativeLang) { setLookupError('Set your native language in Settings first'); return; }
    if (!targetLang) { setLookupError('Select a target language'); return; }
    setLooking(true);
    setLookupError('');
    setLookedUp(false);
    setPreview(null);
    try {
      const result = await api.lookupPostWords(wordLines, nativeLang, targetLang);
      setPreview(result.words);
      setLookedUp(true);
    } catch (err: any) {
      console.error('lookupPostWords failed:', err);
      setLookupError(err instanceof Error ? err.message : String(err));
    } finally {
      setLooking(false);
    }
  };

  const handleSubmit = async () => {
    if (!preview || preview.length === 0) { setSubmitError('No words to post'); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit({
        title,
        words: preview.map(w => ({ word: w.word, image_url: w.image_url ?? null, definition: w.definition, example_sentence: w.example_sentence ?? null })),
        target_language: targetLang,
      });
    } catch (err: any) {
      console.error('Create word list post failed:', err);
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-post-tab-content">
      {submitError && <div className="auth-error">{submitError}</div>}
      <label className="form-label">Title</label>
      <input
        className="form-input"
        placeholder="e.g. Chapter 3 Vocabulary"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="form-label">Target Language</label>
      <select
        className="form-input"
        value={targetLang}
        onChange={(e) => { setTargetLang(e.target.value); setLookedUp(false); setPreview(null); }}
      >
        <option value="">Select language…</option>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.name}</option>
        ))}
      </select>
      <label className="form-label">Words (one per line)</label>
      <textarea
        className="form-input stream-textarea"
        placeholder={'casa\ncomer\nfeliz'}
        value={wordsText}
        onChange={(e) => { setWordsText(e.target.value); setLookedUp(false); setPreview(null); }}
        rows={6}
      />
      {lookupError && <div className="auth-error">{lookupError}</div>}
      <button
        className="btn btn-secondary btn-block"
        disabled={looking || wordLines.length === 0}
        onClick={handleLookup}
        style={{ marginBottom: '1rem' }}
      >
        {looking ? 'Looking up…' : 'Look Up Words'}
      </button>
      {lookedUp && preview && preview.length > 0 && (
        <>
          <div className="stream-preview-table">
            <div className="stream-preview-header">
              <span>Image</span>
              <span>Word</span>
              <span>Translation</span>
              <span>Part of speech</span>
              <span />
            </div>
            {preview.map((w, i) => (
              <div key={i} className="stream-preview-row">
                <button
                  className="stream-preview-img-btn"
                  onClick={() => setImagePickerIdx(i)}
                  title="Change image"
                >
                  {w.image_url
                    ? <img src={w.image_url} alt={w.word} />
                    : <span className="stream-preview-img-placeholder" />}
                </button>
                <span className="stream-preview-word">{w.word}</span>
                <span className="stream-preview-translation">
                  <span>{w.translation}</span>
                  <span className="stream-preview-def clickable" onClick={() => setDefPickerIdx(i)}>
                    {w.example_sentence
                      ? renderTildeHighlight(w.example_sentence, 'stream-preview-highlight')
                      : '—'}
                  </span>
                </span>
                <span className="stream-preview-pos">{w.part_of_speech || '—'}</span>
                <button
                  className="btn-small btn-danger"
                  onClick={() => setPreview((prev) => prev ? prev.filter((_, j) => j !== i) : prev)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            className="btn btn-primary btn-block"
            disabled={submitting || preview.length === 0}
            onClick={handleSubmit}
            style={{ marginTop: '1rem' }}
          >
            {submitting ? 'Posting…' : `Post Word List (${preview.length} words)`}
          </button>
          {imagePickerIdx !== null && (
            <ImagePicker
              initialQuery={preview[imagePickerIdx].word}
              onSelect={async (url) => {
                setPreview(prev => prev
                  ? prev.map((p, j) => j === imagePickerIdx ? { ...p, image_url: url } : p)
                  : prev);
              }}
              onClose={() => setImagePickerIdx(null)}
            />
          )}
          {defPickerIdx !== null && (
            <WordLookupModal
              targetLang={targetLang}
              nativeLang={nativeLang}
              initialQuery={preview[defPickerIdx].word}
              onPick={(sense) => {
                setPreview(prev => prev
                  ? prev.map((p, j) => j === defPickerIdx
                      ? { ...p, definition: sense.gloss, part_of_speech: sense.pos || p.part_of_speech, example_sentence: null }
                      : p)
                  : prev);
              }}
              onClose={() => setDefPickerIdx(null)}
            />
          )}
        </>
      )}
      {lookedUp && preview && preview.length === 0 && (
        <p className="classwork-empty">All words were removed. Add more words above.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttachmentLink (display only)
// ---------------------------------------------------------------------------

function AttachmentLink({ att }: { att: StreamAttachment }) {
  const url = att.url;
  const label = att.label || url;
  const isYoutube = url.includes('youtube.com/watch') || url.includes('youtu.be/');
  const isPdf = url.toLowerCase().endsWith('.pdf');

  return (
    <a className="stream-attachment-link" href={url} target="_blank" rel="noopener noreferrer">
      {isYoutube && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8zM9.75 15.5v-7l6.25 3.5-6.25 3.5z" />
        </svg>
      )}
      {isPdf && !isYoutube && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      )}
      {!isYoutube && !isPdf && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      )}
      <span>{label}</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Lesson items display
// ---------------------------------------------------------------------------

function LessonItemsList({ items }: { items: LessonItem[] }) {
  return (
    <div className="lesson-items-display">
      {items.map((item, i) => (
        <div key={i} className="lesson-item-display">
          <div className="lesson-item-display-number">{i + 1}</div>
          <div className="lesson-item-display-content">
            {item.title && <p className="lesson-item-display-title">{item.title}</p>}
            {item.body && <p className="lesson-item-display-body">{item.body}</p>}
            {item.attachments && item.attachments.length > 0 && (
              <div className="stream-attachments">
                {item.attachments.map((att, j) => (
                  <AttachmentLink key={j} att={att} />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit modal (for editing existing posts)
// ---------------------------------------------------------------------------

function EditModal({
  post,
  onSave,
  onClose,
}: {
  post: StreamPost;
  onSave: (updated: StreamPost) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(post.title || '');
  const [body, setBody] = useState(post.body || '');
  const [attachments, setAttachments] = useState<StreamAttachment[]>(post.attachments || []);
  const [lessonItems, setLessonItems] = useState<LessonItem[]>(post.lesson_items || []);
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const data: Parameters<typeof api.updatePost>[1] = { title };
      if (post.type === 'material') { data.body = body; data.attachments = attachments; }
      if (post.type === 'lesson') { data.lesson_items = lessonItems; }
      const updated = await api.updatePost(post.id, data);
      onSave(updated);
    } catch (err: any) {
      console.error('Edit post failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const addLink = () => {
    if (!newUrl.trim()) return;
    setAttachments((prev) => [...prev, { url: newUrl.trim(), label: newLabel.trim() || newUrl.trim() }]);
    setNewUrl('');
    setNewLabel('');
  };

  const updateLessonItem = (i: number, field: keyof LessonItem, value: string) => {
    setLessonItems((prev) => prev.map((it, idx) =>
      idx === i ? { ...it, [field]: value } : it,
    ));
  };

  return (
    <div className="stream-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stream-modal">
        <h2 className="stream-modal-title">Edit Post</h2>
        {error && <div className="auth-error">{error}</div>}
        <label className="form-label">{post.type === 'lesson' ? 'Lesson Title' : 'Title'}</label>
        <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        {post.type === 'material' && (
          <>
            <label className="form-label">Body</label>
            <textarea
              className="form-input stream-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
            />
            <label className="form-label">Links</label>
            {attachments.map((att, i) => (
              <div key={i} className="stream-attachment-row">
                <span className="stream-attachment-url">{att.label || att.url}</span>
                <button
                  className="btn-small btn-danger"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="stream-add-link-row">
              <input className="form-input" placeholder="URL" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} style={{ marginBottom: 0 }} />
              <input className="form-input" placeholder="Label (optional)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ marginBottom: 0 }} />
              <button className="btn-small" onClick={addLink}>+ Add</button>
            </div>
          </>
        )}
        {post.type === 'lesson' && lessonItems.map((item, i) => (
          <div key={i} className="lesson-item-editor" style={{ marginBottom: '1rem' }}>
            <span className="lesson-item-number">Item {i + 1}</span>
            <label className="form-label" style={{ marginTop: '0.5rem' }}>Title</label>
            <input className="form-input" value={item.title} onChange={(e) => updateLessonItem(i, 'title', e.target.value)} />
            <label className="form-label">Notes</label>
            <textarea className="form-input stream-textarea" value={item.body || ''} onChange={(e) => updateLessonItem(i, 'body', e.target.value)} rows={2} />
          </div>
        ))}
        <div className="stream-modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create post modal (replaces /classwork/create navigation)
// ---------------------------------------------------------------------------

function CreatePostModal({
  defaultTab,
  topics,
  user,
  onCreated,
  onClose,
}: {
  defaultTab: 'material' | 'lesson' | 'word_list';
  topics: StreamTopic[];
  user: { native_language: string | null; target_language: string | null };
  onCreated: (post: StreamPost) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'material' | 'lesson' | 'word_list'>(defaultTab);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);

  const handleMaterialSubmit = async (data: { title: string; body: string; attachments: StreamAttachment[] }) => {
    const post = await api.createPost({ type: 'material', ...data, topic_id: selectedTopicId });
    onCreated(post);
  };

  const handleLessonSubmit = async (data: { title: string; lesson_items: LessonItem[] }) => {
    const post = await api.createPost({ type: 'lesson', ...data, topic_id: selectedTopicId });
    onCreated(post);
  };

  const handleWordListSubmit = async (data: { title: string; words: (string | WordOverride)[]; target_language: string }) => {
    const post = await api.createPost({ type: 'word_list', ...data, topic_id: selectedTopicId });
    onCreated(post);
  };

  return (
    <div className="stream-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stream-modal stream-create-modal">
        <div className="stream-create-modal-header">
          <h2 className="stream-modal-title">New Post</h2>
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

        <div className="create-post-tabs">
          <button className={`create-post-tab${tab === 'material' ? ' active' : ''}`} onClick={() => setTab('material')}>Material</button>
          <button className={`create-post-tab${tab === 'lesson' ? ' active' : ''}`} onClick={() => setTab('lesson')}>Lesson</button>
          <button className={`create-post-tab${tab === 'word_list' ? ' active' : ''}`} onClick={() => setTab('word_list')}>Word List</button>
        </div>

        {tab === 'material' && <MaterialTab onSubmit={handleMaterialSubmit} />}
        {tab === 'lesson' && <LessonTab onSubmit={handleLessonSubmit} />}
        {tab === 'word_list' && (
          <WordListTab
            defaultTargetLang={user?.target_language || ''}
            nativeLang={user?.native_language || ''}
            onSubmit={handleWordListSubmit}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post context menu (···)
// ---------------------------------------------------------------------------

function PostMenu({
  topics,
  currentTopicId,
  onEdit,
  onDelete,
  onMoveTo,
  onClose,
}: {
  topics: StreamTopic[];
  currentTopicId: string | null | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onMoveTo: (topicId: string | null) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const moveTargets = topics.filter((t) => t.id !== currentTopicId);
  const canMoveToNoTopic = !!currentTopicId;

  return (
    <div ref={menuRef} className="stream-post-menu">
      <button className="stream-post-menu-item" onClick={() => { onEdit(); onClose(); }}>Edit</button>
      <button className="stream-post-menu-item stream-post-menu-item--danger" onClick={() => { onDelete(); onClose(); }}>Delete</button>
      {(moveTargets.length > 0 || canMoveToNoTopic) && (
        <>
          <div className="stream-post-menu-separator" />
          <div
            className="stream-post-menu-item stream-post-menu-item--has-submenu"
            onMouseEnter={() => setShowMoveMenu(true)}
            onMouseLeave={() => setShowMoveMenu(false)}
          >
            <span>Move to</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
            {showMoveMenu && (
              <div className="stream-post-menu stream-post-submenu">
                {canMoveToNoTopic && (
                  <button className="stream-post-menu-item" onClick={() => { onMoveTo(null); onClose(); }}>
                    No Topic
                  </button>
                )}
                {moveTargets.map((t) => (
                  <button key={t.id} className="stream-post-menu-item" onClick={() => { onMoveTo(t.id); onClose(); }}>
                    {t.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teacher post card with drag handle + ··· menu
// ---------------------------------------------------------------------------

function TeacherPostCard({
  post,
  topics,
  onDelete,
  onEdit,
  onMoveTo,
  isDragOver,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  post: StreamPost;
  topics: StreamTopic[];
  onDelete: (id: string) => void;
  onEdit: (post: StreamPost) => void;
  onMoveTo: (topicId: string | null) => void;
  isDragOver: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Delete this post? Students will no longer see it.')) return;
    setDeleting(true);
    try {
      await api.deletePost(post.id);
      onDelete(post.id);
    } catch (err) {
      console.error('Delete post failed:', err);
      setDeleting(false);
    }
  };

  const badgeLabel = post.type === 'material' ? 'Material' : post.type === 'lesson' ? 'Lesson' : 'Word List';

  return (
    <div
      className={`stream-post-card${post.type === 'lesson' ? ' stream-post-card--lesson' : ''}${isDragOver ? ' stream-post-drag-over' : ''}${draggable ? ' stream-post-card--draggable' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="stream-post-header">
        {draggable && <span className="stream-post-drag-handle">⠿</span>}
        <span className={`stream-post-type-badge${post.type === 'lesson' ? ' stream-post-type-badge--lesson' : ''}`}>
          {badgeLabel}
        </span>
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            className="stream-post-menu-btn"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((prev) => !prev); }}
            aria-label="Post options"
          >
            ···
          </button>
          {menuOpen && (
            <PostMenu
              topics={topics}
              currentTopicId={post.topic_id}
              onEdit={() => onEdit(post)}
              onDelete={handleDelete}
              onMoveTo={onMoveTo}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>

      {post.title && <h3 className="stream-post-title">{post.title}</h3>}

      {post.type === 'material' && (
        <>
          {post.body && <p className="stream-post-body">{post.body}</p>}
          {post.attachments && post.attachments.length > 0 && (
            <div className="stream-attachments">
              {post.attachments.map((att, i) => <AttachmentLink key={i} att={att} />)}
            </div>
          )}
        </>
      )}

      {post.type === 'lesson' && <LessonItemsList items={post.lesson_items || []} />}

      {post.type === 'word_list' && (
        <>
          <div className="stream-word-chips-preview">
            {(post.words || []).slice(0, 6).map((w) => (
              <span key={w.id} className="stream-word-chip">{w.word}</span>
            ))}
            {(post.word_count || 0) > 6 && (
              <span className="stream-word-chip stream-word-chip--more">
                +{(post.word_count || 0) - 6} more
              </span>
            )}
          </div>
          <p className="stream-word-count-label">{post.word_count || 0} words</p>
        </>
      )}

      {deleting && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Deleting…</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topic context menu (rename, delete)
// ---------------------------------------------------------------------------

function TopicMenu({
  onRename,
  onDelete,
  onClose,
}: {
  onRename: () => void;
  onDelete: () => void;
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
    <div ref={menuRef} className="stream-post-menu">
      <button className="stream-post-menu-item" onClick={() => { onRename(); onClose(); }}>Rename</button>
      <button className="stream-post-menu-item stream-post-menu-item--danger" onClick={() => { onDelete(); onClose(); }}>Delete</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student post cards
// ---------------------------------------------------------------------------

function StudentWordListCard({
  post,
  onUpdate,
}: {
  post: StreamPost;
  onUpdate: (updated: Partial<StreamPost> & { id: string }) => void;
}) {
  const [knownIds, setKnownIds] = useState<Set<string>>(new Set(post.known_word_ids || []));
  const [completed, setCompleted] = useState(post.completed || false);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ added: number; skipped: number } | null>(null);
  const [error, setError] = useState('');

  const words = post.words || [];
  const unknownCount = words.filter((w) => !knownIds.has(w.id)).length;

  const toggleKnown = async (word: StreamPostWord) => {
    const wasKnown = knownIds.has(word.id);
    const newKnown = !wasKnown;
    setKnownIds((prev) => {
      const next = new Set(prev);
      if (newKnown) next.add(word.id); else next.delete(word.id);
      return next;
    });
    try {
      await api.toggleWordKnown(post.id, word.id, newKnown);
    } catch (err: any) {
      console.error('toggleWordKnown failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      setKnownIds((prev) => {
        const next = new Set(prev);
        if (wasKnown) next.add(word.id); else next.delete(word.id);
        return next;
      });
    }
  };

  const handleAddToDictionary = async () => {
    setAdding(true);
    setError('');
    try {
      const result = await api.addPostToDictionary(post.id);
      setAddResult(result);
      setCompleted(true);
      onUpdate({ id: post.id, completed: true });
    } catch (err: any) {
      console.error('addPostToDictionary failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="stream-post-card">
      <div className="stream-post-header">
        <span className="stream-post-type-badge">Word List</span>
        {post.target_language && (
          <span className="stream-lang-badge">{post.target_language.toUpperCase()}</span>
        )}
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>
      {post.title && <h3 className="stream-post-title">{post.title}</h3>}
      {error && <div className="auth-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
      <div className="stream-word-chips-grid">
        {words.map((w) => {
          const isKnown = knownIds.has(w.id);
          return (
            <button
              key={w.id}
              className={`stream-word-chip stream-word-chip--interactive${isKnown ? ' stream-word-chip--known' : ''}`}
              onClick={() => toggleKnown(w)}
              title={isKnown ? 'Unmark as known' : 'Mark as known'}
            >
              <span className="stream-chip-word">{w.word}</span>
              {w.translation && <span className="stream-chip-translation"> — {w.translation}</span>}
            </button>
          );
        })}
      </div>
      <div className="stream-word-known-counter">
        <span>{knownIds.size} known</span>
        <span className="stream-counter-dot">·</span>
        <span>{unknownCount} to add</span>
      </div>
      {completed || addResult ? (
        <div className="stream-completed-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {addResult
            ? `Added ${addResult.added} word${addResult.added !== 1 ? 's' : ''} to your dictionary`
            : 'Added to your dictionary'}
        </div>
      ) : (
        <button
          className="btn btn-primary"
          disabled={unknownCount === 0 || adding}
          onClick={handleAddToDictionary}
          style={{ marginTop: '0.75rem' }}
        >
          {adding ? 'Adding…' : `Add ${unknownCount} Word${unknownCount !== 1 ? 's' : ''} to Dictionary`}
        </button>
      )}
    </div>
  );
}

function StudentMaterialCard({ post }: { post: StreamPost }) {
  return (
    <div className="stream-post-card">
      <div className="stream-post-header">
        <span className="stream-post-type-badge">Material</span>
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>
      {post.title && <h3 className="stream-post-title">{post.title}</h3>}
      {post.body && <p className="stream-post-body">{post.body}</p>}
      {post.attachments && post.attachments.length > 0 && (
        <div className="stream-attachments">
          {post.attachments.map((att, i) => <AttachmentLink key={i} att={att} />)}
        </div>
      )}
    </div>
  );
}

function StudentLessonCard({ post }: { post: StreamPost }) {
  return (
    <div className="stream-post-card stream-post-card--lesson">
      <div className="stream-post-header">
        <span className="stream-post-type-badge stream-post-type-badge--lesson">Lesson</span>
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>
      {post.title && <h3 className="stream-post-title">{post.title}</h3>}
      <LessonItemsList items={post.lesson_items || []} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topic section
// ---------------------------------------------------------------------------

function TopicSection({
  topic,
  posts,
  topics,
  isTeacher,
  collapsed,
  onToggleCollapse,
  onDeletePost,
  onEditPost,
  onMovePost,
  onRenameTopic,
  onDeleteTopic,
  dragItem,
  dragOverId,
  onDragStartPost,
  onDragOverPost,
  onDropPost,
  onDragEndPost,
  onDragStartTopic,
  onDragOverTopic,
  onDropTopic,
  onStudentUpdate,
}: {
  topic: StreamTopic | null;
  posts: StreamPost[];
  topics: StreamTopic[];
  isTeacher: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onDeletePost: (id: string) => void;
  onEditPost: (post: StreamPost) => void;
  onMovePost: (postId: string, topicId: string | null) => void;
  onRenameTopic: (updated: StreamTopic) => void;
  onDeleteTopic: (topicId: string) => void;
  dragItem: { id: string; kind: 'post' | 'topic' } | null;
  dragOverId: string | null;
  onDragStartPost: (e: React.DragEvent, post: StreamPost) => void;
  onDragOverPost: (postId: string) => void;
  onDropPost: (e: React.DragEvent, targetPostId: string, topicId: string | null) => void;
  onDragEndPost: () => void;
  onDragStartTopic: (e: React.DragEvent, topic: StreamTopic) => void;
  onDragOverTopic: (topicId: string) => void;
  onDropTopic: (e: React.DragEvent, targetTopicId: string) => void;
  onStudentUpdate: (partial: Partial<StreamPost> & { id: string }) => void;
}) {
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(topic?.title || '');

  const isNoTopic = topic === null;
  const topicId = topic?.id ?? null;
  const isBeingDragged = !isNoTopic && dragItem?.id === topic?.id && dragItem?.kind === 'topic';
  const isDropTarget = !isNoTopic && dragOverId === topic?.id && dragItem?.kind === 'topic';

  const sortedPosts = [...posts].sort((a, b) =>
    (a.position ?? 0) - (b.position ?? 0) ||
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const handleRenameSubmit = async () => {
    if (!renameTitle.trim() || !topic) { setRenaming(false); return; }
    try {
      const updated = await api.updateTopic(topic.id, { title: renameTitle.trim() });
      onRenameTopic(updated);
    } catch (err) {
      console.error('Rename topic failed:', err);
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div
      className={`stream-topic-section${isNoTopic ? ' stream-no-topic-section' : ''}${isDropTarget ? ' stream-topic-section--drop-target' : ''}`}
      onDragOver={!isNoTopic && isTeacher ? (e) => { if (dragItem?.kind === 'topic') { e.preventDefault(); onDragOverTopic(topic!.id); } } : undefined}
      onDrop={!isNoTopic && isTeacher ? (e) => { if (dragItem?.kind === 'topic') onDropTopic(e, topic!.id); } : undefined}
    >
      <div
        className={`stream-topic-header${isBeingDragged ? ' stream-topic-header--dragging' : ''}`}
        draggable={isTeacher && !isNoTopic}
        onDragStart={isTeacher && !isNoTopic ? (e) => onDragStartTopic(e, topic!) : undefined}
        onDragEnd={isTeacher && !isNoTopic ? () => {} : undefined}
      >
        {isTeacher && !isNoTopic && (
          <span className="stream-topic-drag-handle">⠿</span>
        )}

        {renaming ? (
          <input
            className="stream-topic-rename-input"
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setRenaming(false);
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="stream-topic-title">
            {isNoTopic ? 'No Topic' : topic!.title}
          </span>
        )}

        <span className="stream-topic-count">{posts.length}</span>

        <button
          className={`stream-topic-chevron${collapsed ? ' stream-topic-chevron--collapsed' : ''}`}
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>

        {isTeacher && !isNoTopic && !renaming && (
          <div style={{ position: 'relative' }}>
            <button
              className="stream-topic-menu-btn"
              onClick={(e) => { e.stopPropagation(); setTopicMenuOpen((prev) => !prev); }}
              aria-label="Topic options"
            >
              ···
            </button>
            {topicMenuOpen && (
              <TopicMenu
                onRename={() => { setRenameTitle(topic!.title); setRenaming(true); }}
                onDelete={() => onDeleteTopic(topic!.id)}
                onClose={() => setTopicMenuOpen(false)}
              />
            )}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="stream-topic-posts">
          {sortedPosts.length === 0 && (
            <div className="stream-topic-empty">
              {isNoTopic ? 'No unassigned posts.' : 'No posts in this topic.'}
            </div>
          )}
          {sortedPosts.map((post) => {
            if (isTeacher) {
              return (
                <div
                  key={post.id}
                  className={dragOverId === post.id && dragItem?.kind === 'post' ? 'stream-post-drop-indicator' : ''}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (dragItem?.kind === 'post') onDragOverPost(post.id); }}
                  onDrop={(e) => { e.stopPropagation(); onDropPost(e, post.id, topicId); }}
                >
                  <TeacherPostCard
                    post={post}
                    topics={topics}
                    onDelete={onDeletePost}
                    onEdit={onEditPost}
                    onMoveTo={(newTopicId) => onMovePost(post.id, newTopicId)}
                    isDragOver={dragOverId === post.id && dragItem?.kind === 'post'}
                    draggable={true}
                    onDragStart={(e) => onDragStartPost(e, post)}
                    onDragEnd={onDragEndPost}
                  />
                </div>
              );
            }

            // Student view
            const showTeacherLabel = !isNoTopic && !!post.teacher_name;
            if (post.type === 'word_list') {
              return (
                <React.Fragment key={post.id}>
                  {showTeacherLabel && <div className="stream-teacher-label">{post.teacher_name}</div>}
                  <StudentWordListCard post={post} onUpdate={onStudentUpdate} />
                </React.Fragment>
              );
            } else if (post.type === 'lesson') {
              return (
                <React.Fragment key={post.id}>
                  {showTeacherLabel && <div className="stream-teacher-label">{post.teacher_name}</div>}
                  <StudentLessonCard post={post} />
                </React.Fragment>
              );
            } else {
              return (
                <React.Fragment key={post.id}>
                  {showTeacherLabel && <div className="stream-teacher-label">{post.teacher_name}</div>}
                  <StudentMaterialCard post={post} />
                </React.Fragment>
              );
            }
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// + Create dropdown menu
// ---------------------------------------------------------------------------

function CreateMenu({
  onSelect,
  onClose,
}: {
  onSelect: (type: 'material' | 'lesson' | 'word_list' | 'topic') => void;
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
      <div className="stream-create-menu-separator" />
      <button className="stream-create-menu-item" onClick={() => { onSelect('topic'); onClose(); }}>
        <span className="stream-create-menu-icon">＋</span> New Topic
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Classwork component
// ---------------------------------------------------------------------------

export default function Classwork() {
  const { user } = useAuth();
  const isTeacher = user?.account_type === 'teacher';

  const [topics, setTopics] = useState<StreamTopic[]>([]);
  const [posts, setPosts] = useState<StreamPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingPost, setEditingPost] = useState<StreamPost | null>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [createType, setCreateType] = useState<'material' | 'lesson' | 'word_list' | null>(null);
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [dragItem, setDragItem] = useState<{ id: string; kind: 'post' | 'topic' } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const loadStream = useCallback(() => {
    setLoading(true);
    setError('');
    api.getStream()
      .then(({ topics: fetchedTopics, posts: fetchedPosts }) => {
        setTopics(fetchedTopics);
        setPosts(fetchedPosts);
      })
      .catch((err: any) => {
        console.error('getStream failed:', err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadStream(); }, [loadStream]);

  // ---- Post handlers ----

  const handleDeletePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));
  const handleEditPost = (post: StreamPost) => setEditingPost(post);
  const handleEditSaved = (updated: StreamPost) => {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    setEditingPost(null);
  };
  const handleStudentUpdate = (partial: Partial<StreamPost> & { id: string }) => {
    setPosts((prev) => prev.map((p) => (p.id === partial.id ? { ...p, ...partial } : p)));
  };
  const handlePostCreated = (post: StreamPost) => {
    setPosts((prev) => [post, ...prev]);
    setCreateType(null);
  };

  const handleMovePost = async (postId: string, newTopicId: string | null) => {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, topic_id: newTopicId } : p)));
    try {
      await api.reorderStream([{ id: postId, kind: 'post', position: post.position ?? 0, topic_id: newTopicId }]);
    } catch (err: any) {
      console.error('Move post failed:', err);
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, topic_id: post.topic_id } : p)));
    }
  };

  // ---- Topic handlers ----

  const handleRenameTopic = (updated: StreamTopic) => {
    setTopics((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleDeleteTopic = async (topicId: string) => {
    if (!confirm('Delete this topic? Posts will be moved to "No Topic".')) return;
    try {
      await api.deleteTopic(topicId);
      setTopics((prev) => prev.filter((t) => t.id !== topicId));
      setPosts((prev) => prev.map((p) => (p.topic_id === topicId ? { ...p, topic_id: null } : p)));
    } catch (err: any) {
      console.error('Delete topic failed:', err);
    }
  };

  const handleCreateTopic = async () => {
    if (!newTopicTitle.trim()) { setCreatingTopic(false); return; }
    try {
      const topic = await api.createTopic(newTopicTitle.trim());
      setTopics((prev) => [...prev, topic]);
    } catch (err: any) {
      console.error('Create topic failed:', err);
    } finally {
      setNewTopicTitle('');
      setCreatingTopic(false);
    }
  };

  const handleCreateMenuSelect = (type: 'material' | 'lesson' | 'word_list' | 'topic') => {
    if (type === 'topic') {
      setCreatingTopic(true);
    } else {
      setCreateType(type);
    }
  };

  // ---- Collapse toggle ----

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ---- Drag and drop ----

  const handleDragStartPost = (e: React.DragEvent, post: StreamPost) => {
    setDragItem({ id: post.id, kind: 'post' });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverPost = (postId: string) => {
    if (dragItem?.kind === 'post') setDragOverId(postId);
  };

  const handleDropPost = (e: React.DragEvent, targetPostId: string, topicId: string | null) => {
    e.preventDefault();
    if (!dragItem || dragItem.kind !== 'post' || dragItem.id === targetPostId) {
      setDragItem(null);
      setDragOverId(null);
      return;
    }

    const normalizeId = (id: string | null | undefined) => id ?? null;
    const topicPosts = posts
      .filter((p) => normalizeId(p.topic_id) === topicId)
      .sort((a, b) =>
        (a.position ?? 0) - (b.position ?? 0) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

    const dragIndex = topicPosts.findIndex((p) => p.id === dragItem.id);
    const targetIndex = topicPosts.findIndex((p) => p.id === targetPostId);
    if (dragIndex === -1 || targetIndex === -1) { setDragItem(null); setDragOverId(null); return; }

    const reordered = [...topicPosts];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    const items = reordered.map((p, i) => ({ id: p.id, kind: 'post' as const, position: i, topic_id: topicId }));

    setPosts((prev) => {
      const others = prev.filter((p) => normalizeId(p.topic_id) !== topicId);
      return [...others, ...reordered.map((p, i) => ({ ...p, position: i }))];
    });

    api.reorderStream(items).catch((err: any) => {
      console.error('Reorder posts failed:', err);
      loadStream();
    });

    setDragItem(null);
    setDragOverId(null);
  };

  const handleDragEndPost = () => {
    setDragItem(null);
    setDragOverId(null);
  };

  const handleDragStartTopic = (e: React.DragEvent, topic: StreamTopic) => {
    setDragItem({ id: topic.id, kind: 'topic' });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverTopic = (topicId: string) => {
    if (dragItem?.kind === 'topic') setDragOverId(topicId);
  };

  const handleDropTopic = (e: React.DragEvent, targetTopicId: string) => {
    e.preventDefault();
    if (!dragItem || dragItem.kind !== 'topic' || dragItem.id === targetTopicId) {
      setDragItem(null);
      setDragOverId(null);
      return;
    }

    const dragIndex = topics.findIndex((t) => t.id === dragItem.id);
    const targetIndex = topics.findIndex((t) => t.id === targetTopicId);
    if (dragIndex === -1 || targetIndex === -1) { setDragItem(null); setDragOverId(null); return; }

    const reordered = [...topics];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    setTopics(reordered.map((t, i) => ({ ...t, position: i })));

    api.reorderStream(reordered.map((t, i) => ({ id: t.id, kind: 'topic' as const, position: i }))).catch((err: any) => {
      console.error('Reorder topics failed:', err);
      loadStream();
    });

    setDragItem(null);
    setDragOverId(null);
  };

  // ---- Grouping ----

  const noTopicPosts = posts.filter((p) => !p.topic_id);

  const isEmpty = posts.length === 0 && topics.length === 0 && !creatingTopic;

  return (
    <div className="classwork-page">
      <div className="classwork-header">
        <h1 className="classwork-title">Classwork</h1>
        {isTeacher && (
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-primary btn-sm stream-create-btn"
              onClick={() => setShowCreateMenu((prev) => !prev)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: '2px' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showCreateMenu && (
              <CreateMenu
                onSelect={handleCreateMenuSelect}
                onClose={() => setShowCreateMenu(false)}
              />
            )}
          </div>
        )}
      </div>

      {error && <div className="auth-error">{error}</div>}

      {loading ? (
        <div className="loading-screen"><div className="loading-spinner" /></div>
      ) : isEmpty ? (
        <div className="classwork-empty">
          {isTeacher
            ? 'No posts yet. Click "Create" to share materials, lessons, or word lists.'
            : "Your teacher hasn't posted anything yet, or you haven't been added to a class."}
        </div>
      ) : (
        <div className="classwork-feed">

          {/* No-topic section */}
          {(noTopicPosts.length > 0 || (isTeacher && posts.length === 0 && topics.length === 0)) && (
            <TopicSection
              topic={null}
              posts={noTopicPosts}
              topics={topics}
              isTeacher={isTeacher}
              collapsed={collapsed.has('__no_topic__')}
              onToggleCollapse={() => toggleCollapse('__no_topic__')}
              onDeletePost={handleDeletePost}
              onEditPost={handleEditPost}
              onMovePost={handleMovePost}
              onRenameTopic={handleRenameTopic}
              onDeleteTopic={handleDeleteTopic}
              dragItem={dragItem}
              dragOverId={dragOverId}
              onDragStartPost={handleDragStartPost}
              onDragOverPost={handleDragOverPost}
              onDropPost={handleDropPost}
              onDragEndPost={handleDragEndPost}
              onDragStartTopic={handleDragStartTopic}
              onDragOverTopic={handleDragOverTopic}
              onDropTopic={handleDropTopic}
              onStudentUpdate={handleStudentUpdate}
            />
          )}

          {/* Named topic sections */}
          {topics.map((topic) => (
            <TopicSection
              key={topic.id}
              topic={topic}
              posts={posts.filter((p) => p.topic_id === topic.id)}
              topics={topics}
              isTeacher={isTeacher}
              collapsed={collapsed.has(topic.id)}
              onToggleCollapse={() => toggleCollapse(topic.id)}
              onDeletePost={handleDeletePost}
              onEditPost={handleEditPost}
              onMovePost={handleMovePost}
              onRenameTopic={handleRenameTopic}
              onDeleteTopic={handleDeleteTopic}
              dragItem={dragItem}
              dragOverId={dragOverId}
              onDragStartPost={handleDragStartPost}
              onDragOverPost={handleDragOverPost}
              onDropPost={handleDropPost}
              onDragEndPost={handleDragEndPost}
              onDragStartTopic={handleDragStartTopic}
              onDragOverTopic={handleDragOverTopic}
              onDropTopic={handleDropTopic}
              onStudentUpdate={handleStudentUpdate}
            />
          ))}

          {/* Inline new topic input */}
          {creatingTopic && (
            <div className="stream-topic-section stream-topic-section--creating">
              <div className="stream-topic-header">
                <input
                  className="stream-topic-rename-input"
                  placeholder="Topic name…"
                  value={newTopicTitle}
                  onChange={(e) => setNewTopicTitle(e.target.value)}
                  onBlur={handleCreateTopic}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateTopic();
                    if (e.key === 'Escape') { setCreatingTopic(false); setNewTopicTitle(''); }
                  }}
                  autoFocus
                />
              </div>
            </div>
          )}
        </div>
      )}

      {editingPost && (
        <EditModal post={editingPost} onSave={handleEditSaved} onClose={() => setEditingPost(null)} />
      )}

      {createType && (
        <CreatePostModal
          defaultTab={createType}
          topics={topics}
          user={user!}
          onCreated={handlePostCreated}
          onClose={() => setCreateType(null)}
        />
      )}
    </div>
  );
}
