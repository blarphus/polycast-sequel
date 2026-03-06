// ---------------------------------------------------------------------------
// pages/Browse.tsx -- YouTube-like browse page with trending grid + search
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getTrendingVideos, searchVideos, getLessons, TrendingVideo, LessonSummary } from '../api';
import { LANGUAGES } from '../components/classwork/languages';
import { SearchIcon, CloseIcon } from '../components/icons';
import LessonCard from '../components/cards/LessonCard';
import Carousel from '../components/Carousel';
import { VideoGridCard, VideoGridSkeleton } from '../components/video/VideoGridCard';
import { useVideoClick } from '../hooks/useVideoClick';
import { filterUnplayableVideos } from '../utils/playabilityFilter';

export default function Browse() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [videos, setVideos] = useState<TrendingVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(30);
  const inputRef = useRef<HTMLInputElement>(null);

  const targetLang = user?.target_language;
  const langName = LANGUAGES.find((l) => l.code === targetLang)?.name || targetLang || '';
  const { addingVideoId, handleVideoClick } = useVideoClick(targetLang || 'en');

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
        setVisibleCount(30);
        filterUnplayableVideos(v, setVideos);
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
        setVisibleCount(30);
        filterUnplayableVideos(v, setVideos);
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
        setVisibleCount(30);
        filterUnplayableVideos(v, setVideos);
      })
      .catch((err) => {
        console.error('Failed to fetch trending videos:', err);
        setError('Failed to load videos. Please try again.');
      })
      .finally(() => setLoading(false));
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
          onOverflowClick={() => navigate('/lessons')}
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
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              onClick={() => navigate(`/lesson/${lesson.id}`)}
            />
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
            <VideoGridSkeleton key={i} />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="home-empty-state">
          <p>{activeQuery ? `No results for "${activeQuery}".` : 'No videos available right now.'}</p>
        </div>
      ) : (
        <>
          <div className="browse-grid">
            {videos.slice(0, visibleCount).map((v) => (
              <VideoGridCard
                key={v.youtube_id}
                video={v}
                loading={addingVideoId === v.youtube_id}
                onClick={() => handleVideoClick(v)}
              />
            ))}
          </div>
          {visibleCount < videos.length && (
            <button
              className="btn btn-secondary browse-load-more"
              onClick={() => setVisibleCount((c) => c + 30)}
            >
              Load More
            </button>
          )}
        </>
      )}
    </div>
  );
}
