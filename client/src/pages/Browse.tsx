// ---------------------------------------------------------------------------
// pages/Browse.tsx -- YouTube-like browse page with trending grid + search
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getTrendingVideos, searchVideos, addVideo, checkVideoPlayability, TrendingVideo } from '../api';
import { LANGUAGES } from '../components/classwork/languages';
import { SearchIcon, CloseIcon } from '../components/icons';

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Browse() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [videos, setVideos] = useState<TrendingVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [addingVideoId, setAddingVideoId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const targetLang = user?.target_language;
  const langName = LANGUAGES.find((l) => l.code === targetLang)?.name || targetLang || '';

  // Load trending on mount (or when target language changes)
  useEffect(() => {
    if (!targetLang) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');

    getTrendingVideos(targetLang)
      .then((v) => {
        if (cancelled) return;
        setVideos(v);
        // Two-phase: show immediately, then filter age-restricted
        const ids = v.map((vid) => vid.youtube_id);
        if (ids.length > 0) {
          checkVideoPlayability(ids)
            .then((blocked) => {
              if (!cancelled && blocked.size > 0) {
                setVideos((prev) => prev.filter((vid) => !blocked.has(vid.youtube_id)));
              }
            })
            .catch((err) => console.error('Playability check failed:', err));
        }
      })
      .catch((err) => {
        console.error('Failed to fetch trending videos:', err);
        if (!cancelled) setError('Failed to load videos. Please try again.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [targetLang]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || !targetLang) return;

    setActiveQuery(trimmed);
    setLoading(true);
    setError('');

    searchVideos(trimmed, targetLang)
      .then((v) => {
        setVideos(v);
        const ids = v.map((vid) => vid.youtube_id);
        if (ids.length > 0) {
          checkVideoPlayability(ids)
            .then((blocked) => {
              if (blocked.size > 0) {
                setVideos((prev) => prev.filter((vid) => !blocked.has(vid.youtube_id)));
              }
            })
            .catch((err) => console.error('Playability check failed:', err));
        }
      })
      .catch((err) => {
        console.error('Search failed:', err);
        setError('Search failed. Please try again.');
      })
      .finally(() => setLoading(false));
  }

  function handleClear() {
    setQuery('');
    setActiveQuery('');
    inputRef.current?.focus();

    if (!targetLang) return;
    setLoading(true);
    setError('');

    getTrendingVideos(targetLang)
      .then((v) => {
        setVideos(v);
        const ids = v.map((vid) => vid.youtube_id);
        if (ids.length > 0) {
          checkVideoPlayability(ids)
            .then((blocked) => {
              if (blocked.size > 0) {
                setVideos((prev) => prev.filter((vid) => !blocked.has(vid.youtube_id)));
              }
            })
            .catch((err) => console.error('Playability check failed:', err));
        }
      })
      .catch((err) => {
        console.error('Failed to fetch trending videos:', err);
        setError('Failed to load videos. Please try again.');
      })
      .finally(() => setLoading(false));
  }

  async function handleVideoClick(video: TrendingVideo) {
    if (addingVideoId) return;
    setAddingVideoId(video.youtube_id);
    try {
      const url = `https://www.youtube.com/watch?v=${video.youtube_id}`;
      const added = await addVideo(url, targetLang || 'en');
      navigate(`/watch/${added.id}`);
    } catch (err) {
      console.error('Failed to add video:', err);
      setAddingVideoId(null);
    }
  }

  // Section heading
  let sectionTitle = '';
  if (!targetLang) {
    sectionTitle = 'Videos for you';
  } else if (activeQuery) {
    sectionTitle = `Results for "${activeQuery}"`;
  } else if (targetLang === 'en') {
    sectionTitle = 'Free Movies & TV';
  } else {
    sectionTitle = `Trending in ${langName}`;
  }

  return (
    <div className="browse-page">
      {/* Search bar */}
      <form className="browse-search-bar" onSubmit={handleSearch}>
        <SearchIcon size={18} className="browse-search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="browse-search-input"
          placeholder={`Search ${langName || 'videos'}...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="browse-search-clear" onClick={handleClear}>
            <CloseIcon size={16} />
          </button>
        )}
      </form>

      {/* Section header */}
      <h2 className="browse-section-title">{sectionTitle}</h2>

      {/* Content */}
      {!targetLang ? (
        <div className="home-empty-state">
          <p>Set a target language in Settings to browse videos.</p>
        </div>
      ) : error ? (
        <div className="home-empty-state">
          <p>{error}</p>
        </div>
      ) : loading ? (
        <div className="browse-grid">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="browse-card browse-card--skeleton">
              <div className="browse-card-thumb browse-card-thumb--skeleton" />
              <div className="browse-card-info">
                <div className="home-skeleton-line" style={{ width: '85%' }} />
                <div className="home-skeleton-line" style={{ width: '55%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="home-empty-state">
          <p>{activeQuery ? `No results for "${activeQuery}".` : 'No videos available right now.'}</p>
        </div>
      ) : (
        <div className="browse-grid">
          {videos.map((v) => (
            <div
              key={v.youtube_id}
              className={`browse-card${addingVideoId === v.youtube_id ? ' browse-card--loading' : ''}`}
              onClick={() => handleVideoClick(v)}
            >
              <div className="browse-card-thumb">
                <img src={v.thumbnail} alt={v.title} className="browse-card-thumb-img" />
                {v.duration_seconds != null && (
                  <span className="browse-card-duration">{formatDuration(v.duration_seconds)}</span>
                )}
              </div>
              <div className="browse-card-info">
                <span className="browse-card-title">{v.title}</span>
                <span className="browse-card-channel">{v.channel}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
