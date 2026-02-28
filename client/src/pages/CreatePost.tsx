// ---------------------------------------------------------------------------
// pages/CreatePost.tsx — Teacher creates a Material or Word List post
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import * as api from '../api';
import type { StreamAttachment, StreamPostWord } from '../api';

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
// Material tab
// ---------------------------------------------------------------------------

function MaterialTab({
  onSubmit,
}: {
  onSubmit: (data: {
    title: string;
    body: string;
    attachments: StreamAttachment[];
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<StreamAttachment[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const addLink = () => {
    if (!newUrl.trim()) return;
    setAttachments((prev) => [
      ...prev,
      { url: newUrl.trim(), label: newLabel.trim() || newUrl.trim() },
    ]);
    setNewUrl('');
    setNewLabel('');
    setShowLinkForm(false);
  };

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
      {attachments.map((att, i) => (
        <div key={i} className="stream-attachment-row">
          <span className="stream-attachment-url">{att.label}</span>
          <button
            className="btn-small btn-danger"
            onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}

      {showLinkForm ? (
        <div className="stream-add-link-form">
          <input
            className="form-input"
            placeholder="https://…"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            autoFocus
          />
          <input
            className="form-input"
            placeholder="Label (optional)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <div className="stream-add-link-row">
            <button className="btn btn-secondary btn-sm" onClick={() => setShowLinkForm(false)}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={addLink}>
              Add Link
            </button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn-secondary btn-sm"
          style={{ marginBottom: '1.25rem' }}
          onClick={() => setShowLinkForm(true)}
        >
          + Add Link
        </button>
      )}

      <button
        className="btn btn-primary btn-block"
        disabled={submitting}
        onClick={handleSubmit}
      >
        {submitting ? 'Posting…' : 'Post Material'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Word List tab
// ---------------------------------------------------------------------------

function WordListTab({
  defaultTargetLang,
  nativeLang,
  onSubmit,
}: {
  defaultTargetLang: string;
  nativeLang: string;
  onSubmit: (data: { title: string; words: string[]; target_language: string }) => Promise<void>;
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

  const wordLines = wordsText
    .split('\n')
    .map((w) => w.trim())
    .filter(Boolean);

  const handleLookup = async () => {
    if (wordLines.length === 0) {
      setLookupError('Enter at least one word');
      return;
    }
    if (!nativeLang) {
      setLookupError('Set your native language in Settings first');
      return;
    }
    if (!targetLang) {
      setLookupError('Select a target language');
      return;
    }
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

  const removePreviewWord = (idx: number) => {
    setPreview((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev));
  };

  const handleSubmit = async () => {
    if (!preview || preview.length === 0) {
      setSubmitError('No words to post');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit({ title, words: preview.map((w) => w.word), target_language: targetLang });
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
        placeholder={"casa\ncomer\nfeliz"}
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
              <span>Word</span>
              <span>Translation</span>
              <span>Part of speech</span>
              <span />
            </div>
            {preview.map((w, i) => (
              <div key={i} className="stream-preview-row">
                <span className="stream-preview-word">{w.word}</span>
                <span className="stream-preview-translation">{w.translation}</span>
                <span className="stream-preview-pos">{w.part_of_speech || '—'}</span>
                <button
                  className="btn-small btn-danger"
                  onClick={() => removePreviewWord(i)}
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
        </>
      )}

      {lookedUp && preview && preview.length === 0 && (
        <p className="classwork-empty">All words were removed. Add more words above.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CreatePost() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'material' | 'word_list'>('material');

  const handleMaterialSubmit = async (data: {
    title: string;
    body: string;
    attachments: StreamAttachment[];
  }) => {
    await api.createPost({ type: 'material', ...data });
    navigate('/classwork');
  };

  const handleWordListSubmit = async (data: {
    title: string;
    words: string[];
    target_language: string;
  }) => {
    await api.createPost({ type: 'word_list', ...data });
    navigate('/classwork');
  };

  return (
    <div className="classwork-page">
      <div className="classwork-header">
        <button className="btn-back" onClick={() => navigate('/classwork')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h1 className="classwork-title">New Post</h1>
      </div>

      <div className="create-post-tabs">
        <button
          className={`create-post-tab${tab === 'material' ? ' active' : ''}`}
          onClick={() => setTab('material')}
        >
          Material
        </button>
        <button
          className={`create-post-tab${tab === 'word_list' ? ' active' : ''}`}
          onClick={() => setTab('word_list')}
        >
          Word List
        </button>
      </div>

      {tab === 'material' ? (
        <MaterialTab onSubmit={handleMaterialSubmit} />
      ) : (
        <WordListTab
          defaultTargetLang={user?.target_language || ''}
          nativeLang={user?.native_language || ''}
          onSubmit={handleWordListSubmit}
        />
      )}
    </div>
  );
}
