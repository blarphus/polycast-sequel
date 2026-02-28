// ---------------------------------------------------------------------------
// components/classwork/CreatePostModal.tsx — Create-post components
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useRef } from 'react';
import * as api from '../../api';
import type { StreamPost, StreamTopic, StreamPostWord, StreamAttachment, LessonItem, WordOverride } from '../../api';
import ImagePicker from '../ImagePicker';
import WordLookupModal from '../WordLookupModal';
import { renderTildeHighlight } from '../../utils/tildeMarkup';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LANGUAGES = [
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
// WordListTab
// ---------------------------------------------------------------------------

function WordListTab({
  defaultTargetLang,
  nativeLang,
  onSubmit,
  initialData,
}: {
  defaultTargetLang: string;
  nativeLang: string;
  onSubmit: (data: { title: string; words: (string | WordOverride)[]; target_language: string }) => Promise<void>;
  initialData?: { title: string; words: StreamPostWord[]; target_language: string };
}) {
  const isEditMode = !!initialData;
  const [title, setTitle] = useState(initialData?.title || '');
  const [targetLang, setTargetLang] = useState(initialData?.target_language || defaultTargetLang);
  const [wordsText, setWordsText] = useState('');
  const [preview, setPreview] = useState<StreamPostWord[] | null>(initialData?.words || null);
  const [lookedUp, setLookedUp] = useState(isEditMode);
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
    if (!isEditMode) {
      setLookedUp(false);
      setPreview(null);
    }
    try {
      const result = await api.lookupPostWords(wordLines, nativeLang, targetLang);
      if (isEditMode) {
        // Merge new words into existing preview
        setPreview((prev) => [...(prev || []), ...result.words]);
        setWordsText('');
      } else {
        setPreview(result.words);
      }
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
        words: preview.map(w => ({
          word: w.word,
          translation: w.translation,
          definition: w.definition,
          part_of_speech: w.part_of_speech ?? null,
          frequency: w.frequency ?? null,
          frequency_count: w.frequency_count ?? null,
          example_sentence: w.example_sentence ?? null,
          image_url: w.image_url ?? null,
          lemma: w.lemma ?? null,
          forms: w.forms ?? null,
        })),
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
        onChange={(e) => { setTargetLang(e.target.value); if (!isEditMode) { setLookedUp(false); setPreview(null); } }}
        disabled={isEditMode}
      >
        <option value="">Select language…</option>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.name}</option>
        ))}
      </select>
      <label className="form-label">{isEditMode ? 'Add More Words (one per line)' : 'Words (one per line)'}</label>
      <textarea
        className="form-input stream-textarea"
        placeholder={'casa\ncomer\nfeliz'}
        value={wordsText}
        onChange={(e) => { setWordsText(e.target.value); if (!isEditMode) { setLookedUp(false); setPreview(null); } }}
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
            {submitting
              ? (isEditMode ? 'Saving…' : 'Posting…')
              : (isEditMode ? `Save Word List (${preview.length} words)` : `Post Word List (${preview.length} words)`)}
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
              onPick={async (sense) => {
                const idx = defPickerIdx!;
                const word = preview[idx].word;
                setPreview(prev => prev
                  ? prev.map((p, j) => j === idx
                      ? {
                          ...p,
                          definition: sense.gloss,
                          translation: sense.gloss,
                          part_of_speech: sense.pos || p.part_of_speech,
                          example_sentence: sense.example?.text ?? null,
                        }
                      : p)
                  : prev);
                if (!sense.example?.text) {
                  try {
                    const { example_sentence } = await api.generateExampleSentence(word, targetLang, sense.gloss);
                    setPreview(prev => prev
                      ? prev.map((p, j) => j === idx ? { ...p, example_sentence } : p)
                      : prev);
                  } catch (err) {
                    console.error('Failed to generate example sentence:', err);
                  }
                }
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
  defaultTab: 'material' | 'lesson' | 'word_list';
  topics: StreamTopic[];
  user: { native_language: string | null; target_language: string | null };
  onCreated: (post: StreamPost) => void;
  onClose: () => void;
  editingPost?: StreamPost | null;
  onSaved?: (updated: StreamPost) => void;
}) {
  const isEditMode = !!editingPost;
  const [tab, setTab] = useState<'material' | 'lesson' | 'word_list'>(defaultTab);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(editingPost?.topic_id ?? null);

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
          </div>
        )}

        {tab === 'material' && !isEditMode && <MaterialTab onSubmit={handleMaterialSubmit} />}
        {tab === 'lesson' && !isEditMode && <LessonTab onSubmit={handleLessonSubmit} />}
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
