// ---------------------------------------------------------------------------
// pages/Home.tsx -- Central learning hub (default landing page)
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getNewToday, getVideos, SavedWord, VideoSummary } from '../api';
import FriendRequests from '../components/FriendRequests';
import PendingClasswork from '../components/PendingClasswork';
import AddVideoModal from '../components/AddVideoModal';

const LEVEL_COLORS = ['#ff4d4d', '#ff944d', '#ffdd4d', '#75d147', '#4ade80'];

function FrequencyDots({ frequency }: { frequency: number | null }) {
  if (frequency == null) return null;
  const filled = Math.ceil(frequency / 2);
  const color = LEVEL_COLORS[filled - 1] || LEVEL_COLORS[0];
  return (
    <span className="freq-dots" title={`Frequency: ${frequency}/10`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="freq-dot"
          style={{ background: color, opacity: i < filled ? 1 : 0.25 }}
        />
      ))}
    </span>
  );
}

// Placeholder data for news cards
const MOCK_NEWS = [
  { source: 'El País', headline: 'Nuevas medidas para el turismo sostenible', difficulty: 'B1', words: ['turismo', 'medida'] },
  { source: 'Le Monde', headline: 'Les jeunes et la technologie en 2026', difficulty: 'B2', words: ['jeune', 'technologie'] },
  { source: 'Der Spiegel', headline: 'Klimawandel: Was können wir tun?', difficulty: 'B1', words: ['Klima', 'können'] },
  { source: 'Corriere', headline: 'Il futuro dell\'intelligenza artificiale', difficulty: 'C1', words: ['futuro', 'intelligenza'] },
  { source: 'NHK', headline: '新しい教育プログラムが開始', difficulty: 'B2', words: ['教育', '開始'] },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  A1: '#22a55e', A2: '#22a55e',
  B1: '#3b82f6', B2: '#3b82f6',
  C1: '#8b5cf6', C2: '#8b5cf6',
};

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [newWords, setNewWords] = useState<SavedWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [videosLoading, setVideosLoading] = useState(true);
  const [showAddVideo, setShowAddVideo] = useState(false);
  const videosCarouselRef = useRef<HTMLDivElement | null>(null);
  const newsCarouselRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNewToday()
      .then((words) => { if (!cancelled) setNewWords(words); })
      .catch((err) => {
        console.error('Failed to fetch new words:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    getVideos()
      .then((v) => { if (!cancelled) setVideos(v); })
      .catch((err) => console.error('Failed to fetch videos:', err))
      .finally(() => { if (!cancelled) setVideosLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function refreshVideos() {
    setVideosLoading(true);
    getVideos()
      .then((v) => setVideos(v))
      .catch((err) => console.error('Failed to fetch videos:', err))
      .finally(() => setVideosLoading(false));
  }

  function scrollCarousel(ref: React.RefObject<HTMLDivElement>, direction: 'left' | 'right') {
    const el = ref.current;
    if (!el) return;
    const amount = Math.max(220, Math.floor(el.clientWidth * 0.85));
    el.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  }

  const displayName = user?.display_name || user?.username || '';
  const firstName = displayName.split(/\s+/)[0];

  return (
    <div className="home-page">
      {/* Pending friend requests */}
      <FriendRequests />

      {/* Pending classwork (students only) */}
      {user?.account_type === 'student' && <PendingClasswork />}

      {/* Hero: greeting left, new-words card right */}
      <div className="home-hero">
        <div className="home-hero-left">
          <h1 className="home-greeting">Welcome back, {firstName}</h1>
          <p className="home-greeting-sub">Ready to learn something new?</p>
          <button className="home-start-learning-btn" onClick={() => navigate('/learn')}>
            Start learning
          </button>
        </div>

        <div className="home-hero-right">
          <div className="home-words-card">
            <div className="home-words-card-header">
              <h2 className="home-words-card-title">New words for today</h2>
              <span className="home-words-card-count">
                {loading ? '...' : newWords.length}
              </span>
            </div>

            {error && <p className="auth-error" style={{ margin: '0.5rem 0' }}>{error}</p>}

            {loading ? (
              <div className="home-words-list">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="home-word-row home-word-row--skeleton" />
                ))}
              </div>
            ) : newWords.length === 0 ? (
              <div className="home-empty-state">
                <p>No new words — add some from a call or the dictionary!</p>
              </div>
            ) : (
              <div className="home-words-list">
                {newWords.map((w) => (
                  <div key={w.id} className="home-word-row">
                    <div className="home-word-row-left">
                      <span className="home-word-row-word">{w.word}</span>
                      {w.part_of_speech && (
                        <span className="home-word-row-pos">{w.part_of_speech}</span>
                      )}
                      {w.priority && <span className="assigned-badge">Assigned</span>}
                    </div>
                    <span className="home-word-row-translation">{w.translation}</span>
                    <FrequencyDots frequency={w.frequency} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Videos for you */}
      <section className="home-section">
        <div className="home-section-header">
          <div>
            <h2 className="home-section-title">Videos for you</h2>
            <p className="home-section-subtitle">watch and learn new words</p>
          </div>
          <button className="home-add-video-btn" onClick={() => setShowAddVideo(true)}>+</button>
        </div>
        <div className="home-carousel-shell">
          <button
            className="home-carousel-arrow home-carousel-arrow--left"
            aria-label="Scroll videos left"
            onClick={() => scrollCarousel(videosCarouselRef, 'left')}
          >
            ‹
          </button>
          <div className="home-carousel" ref={videosCarouselRef}>
            {videosLoading ? (
              Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="home-carousel-card home-carousel-card--skeleton">
                  <div className="home-carousel-thumb home-carousel-thumb--skeleton" />
                  <div className="home-carousel-info">
                    <div className="home-skeleton-line" style={{ width: '80%' }} />
                    <div className="home-skeleton-line" style={{ width: '50%' }} />
                  </div>
                </div>
              ))
            ) : (
              videos.map((v) => (
                <div key={v.id} className="home-carousel-card home-carousel-card--clickable" onClick={() => navigate(`/watch/${v.id}`)}>
                  <div className="home-carousel-thumb home-carousel-thumb--video">
                    <img
                      src={`https://img.youtube.com/vi/${v.youtube_id}/mqdefault.jpg`}
                      alt={v.title}
                      className="home-carousel-thumb-img"
                    />
                    {v.duration_seconds != null && (
                      <span className="home-carousel-duration">{formatDuration(v.duration_seconds)}</span>
                    )}
                  </div>
                  <div className="home-carousel-info">
                    <span className="home-carousel-title">{v.title}</span>
                    <span className="home-carousel-channel">{v.channel}</span>
                  </div>
                </div>
              ))
            )}
          </div>
          <button
            className="home-carousel-arrow home-carousel-arrow--right"
            aria-label="Scroll videos right"
            onClick={() => scrollCarousel(videosCarouselRef, 'right')}
          >
            ›
          </button>
        </div>
      </section>

      {/* Section 3: News for you (placeholder) */}
      <section className="home-section">
        <h2 className="home-section-title">News for you</h2>
        <p className="home-section-subtitle">articles with words you know</p>
        <div className="home-carousel-shell">
          <button
            className="home-carousel-arrow home-carousel-arrow--left"
            aria-label="Scroll news left"
            onClick={() => scrollCarousel(newsCarouselRef, 'left')}
          >
            ‹
          </button>
          <div className="home-carousel" ref={newsCarouselRef}>
            {MOCK_NEWS.map((n, i) => (
              <div key={i} className="home-carousel-card">
                <div className="home-carousel-thumb home-carousel-thumb--news">
                  <span className="home-news-source">{n.source}</span>
                </div>
                <div className="home-carousel-info">
                  <span className="home-carousel-title">{n.headline}</span>
                  <div className="home-carousel-meta">
                    <span className="home-difficulty-pill" style={{ background: DIFFICULTY_COLORS[n.difficulty] || '#3b82f6' }}>
                      {n.difficulty}
                    </span>
                    {n.words.map((word) => (
                      <span key={word} className="home-word-badge">{word}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            className="home-carousel-arrow home-carousel-arrow--right"
            aria-label="Scroll news right"
            onClick={() => scrollCarousel(newsCarouselRef, 'right')}
          >
            ›
          </button>
        </div>
      </section>

      {showAddVideo && (
        <AddVideoModal onClose={() => setShowAddVideo(false)} onAdded={refreshVideos} />
      )}
    </div>
  );
}
