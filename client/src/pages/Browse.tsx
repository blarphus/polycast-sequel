// ---------------------------------------------------------------------------
// pages/Browse.tsx -- YouTube-like browse page with trending grid + search
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getTrendingVideos, searchVideos, addVideo, checkVideoPlayability, getLessons, TrendingVideo, LessonSummary } from '../api';
import { LANGUAGES } from '../components/classwork/languages';
import { SearchIcon, CloseIcon } from '../components/icons';
import Carousel from '../components/Carousel';

const LEVEL_COLORS: Record<string, string> = {
  A1: '#22a55e', A2: '#22a55e',
  B1: '#3b82f6', B2: '#3b82f6',
  C1: '#8b5cf6', C2: '#8b5cf6',
};

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
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const targetLang = user?.target_language;
  const langName = LANGUAGES.find((l) => l.code === targetLang)?.name || targetLang || '';

  // Load trending on mount (or when target language changes)
  useEffect(() => {
    if (!targetLang) {
      setLoading(false);
      setLessonsLoading(false);
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

    getLessons(targetLang)
      .then((data) => {
        if (!cancelled) setLessons(data.filter((l) => l.videoCount > 0));
      })
      .catch((err) => console.error('Failed to fetch lessons:', err))
      .finally(() => { if (!cancelled) setLessonsLoading(false); });

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

      {/* Lesson playlists carousel */}
      {targetLang && (lessons.length > 0 || lessonsLoading) && (
        <Carousel
          title="Lesson Playlists"
          subtitle="videos by grammar topic"
          items={lessons}
          loading={lessonsLoading}
          skeletonCount={3}
          maxVisible={10}
          onOverflowClick={() => {/* future: navigate to full lessons list */}}
          renderSkeleton={(i) => (
            <div key={i} className="home-carousel-card lesson-card home-carousel-card--skeleton">
              <div className="home-channel-stack home-carousel-thumb--skeleton" />
              <div className="home-carousel-info">
                <div className="home-skeleton-line" style={{ width: '70%' }} />
                <div className="home-skeleton-line" style={{ width: '40%' }} />
              </div>
            </div>
          )}
          renderItem={(lesson) => (
            <div
              key={lesson.id}
              className="home-carousel-card lesson-card home-carousel-card--clickable"
              onClick={() => navigate(`/lesson/${lesson.id}`)}
            >
              <div className="home-channel-stack">
                {lesson.thumbnails.slice(0, 3).reverse().map((thumb, i, arr) => (
                  <img
                    key={i}
                    src={thumb}
                    alt=""
                    className={`home-channel-stack-img home-channel-stack-img--${arr.length - 1 - i}`}
                  />
                ))}
              </div>
              <div className="home-carousel-info">
                <span className="home-carousel-title">{lesson.title}</span>
                <div className="home-carousel-meta">
                  <span
                    className="lesson-card-level"
                    style={{ background: LEVEL_COLORS[lesson.level] || '#3b82f6' }}
                  >
                    {lesson.level}
                  </span>
                  <span className="lesson-card-count">
                    {lesson.videoCount} video{lesson.videoCount !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </div>
          )}
        />
      )}

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
