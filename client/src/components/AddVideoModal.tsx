import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addVideo } from '../api';
import { LANGUAGES } from './classwork/CreatePostModal';

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

export default function AddVideoModal({ onClose, onAdded }: Props) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [language, setLanguage] = useState('en');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setError('');
    setLoading(true);
    try {
      const video = await addVideo(trimmed, language);
      onAdded();
      onClose();
      navigate(`/watch/${video.id}`);
    } catch (err) {
      console.error('addVideo failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lookup-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lookup-modal">
        <div className="lookup-header">
          <span className="lookup-title">Add video</span>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <form className="add-video-form" onSubmit={handleSubmit}>
          <label className="add-video-label" htmlFor="add-video-url">YouTube URL</label>
          <input
            ref={inputRef}
            id="add-video-url"
            className="lookup-input add-video-input"
            type="url"
            placeholder="https://youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
          />

          <label className="add-video-label" htmlFor="add-video-lang">Language</label>
          <select
            id="add-video-lang"
            className="lookup-input add-video-input"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={loading}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>

          {error && <p className="lookup-error">{error}</p>}

          <button
            type="submit"
            className="home-start-learning-btn add-video-submit"
            disabled={loading || !url.trim()}
          >
            {loading ? 'Adding...' : 'Add video'}
          </button>
        </form>
      </div>
    </div>
  );
}
