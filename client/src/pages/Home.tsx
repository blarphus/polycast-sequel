// ---------------------------------------------------------------------------
// pages/Home.tsx -- Central learning hub (default landing page)
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getNewToday, getTrendingVideos, getNews, getChannels, SavedWord, TrendingVideo, NewsArticle, ChannelSummary } from '../api';
import { LANGUAGES } from '../components/classwork/languages';
import FriendRequests from '../components/FriendRequests';
import PendingClasswork from '../components/PendingClasswork';
import UpcomingClasses from '../components/UpcomingClasses';
import AddVideoModal from '../components/AddVideoModal';
import Carousel from '../components/Carousel';
import { FrequencyDots } from '../components/FrequencyDots';
import { formatVideoDuration, CEFR_COLORS } from '../utils/videoFormat';
import { useVideoClick } from '../hooks/useVideoClick';
import { filterUnplayableVideos } from '../utils/playabilityFilter';

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [newWords, setNewWords] = useState<SavedWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [trending, setTrending] = useState<TrendingVideo[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [showAddVideo, setShowAddVideo] = useState(false);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);

  const targetLang = user?.target_language;
  const langName = LANGUAGES.find((l) => l.code === targetLang)?.name || targetLang || '';
  const { addingVideoId, handleVideoClick: handleTrendingClick } = useVideoClick(targetLang || 'en');

  useEffect(() => {
    let cancelled = false;
    getNewToday()
      .then((words) => { if (!cancelled) setNewWords(words); })
      .catch((err) => {
        console.error('Failed to fetch new words:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    if (targetLang) {
      getTrendingVideos(targetLang)
        .then((v) => {
          if (cancelled) return;
          setTrending(v);
          filterUnplayableVideos(v, setTrending);
        })
        .catch((err) => console.error('Failed to fetch trending videos:', err))
        .finally(() => { if (!cancelled) setTrendingLoading(false); });

      getNews(targetLang, user?.cefr_level)
        .then((articles) => { if (!cancelled) setNews(articles); })
        .catch((err) => console.error('Failed to fetch news:', err))
        .finally(() => { if (!cancelled) setNewsLoading(false); });

      getChannels(targetLang)
        .then((ch) => { if (!cancelled) setChannels(ch); })
        .catch((err) => console.error('Failed to fetch channels:', err))
        .finally(() => { if (!cancelled) setChannelsLoading(false); });
    } else {
      setTrendingLoading(false);
      setNewsLoading(false);
      setChannelsLoading(false);
    }
    return () => { cancelled = true; };
  }, [targetLang]);

  const displayName = user?.display_name || user?.username || '';
  const firstName = displayName.split(/\s+/)[0];

  return (
    <div className="home-page">
      {/* Pending friend requests */}
      <FriendRequests />

      {/* Classes today (both roles) */}
      <UpcomingClasses />

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
                <p>No new words - add some from a call or the dictionary!</p>
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

      {/* Section 2: Trending videos */}
      <Carousel<TrendingVideo>
        title={!targetLang ? 'Videos for you' : targetLang === 'en' ? 'Free Movies & TV' : `Trending in ${langName}`}
        subtitle={targetLang === 'en' ? 'full-length films with captions' : 'watch and learn new words'}
        headerRight={<button className="home-add-video-btn" onClick={() => setShowAddVideo(true)}>+</button>}
        items={trending}
        loading={trendingLoading}
        emptyState={
          <div className="home-empty-state">
            <p>Set a target language in Settings to see trending videos.</p>
          </div>
        }
        renderSkeleton={() => (
          <div className="home-carousel-card home-carousel-card--skeleton">
            <div className="home-carousel-thumb home-carousel-thumb--skeleton" />
            <div className="home-carousel-info">
              <div className="home-skeleton-line" style={{ width: '80%' }} />
              <div className="home-skeleton-line" style={{ width: '50%' }} />
            </div>
          </div>
        )}
        renderItem={(v) => (
          <div
            key={v.youtube_id}
            className={`home-carousel-card home-carousel-card--clickable${addingVideoId === v.youtube_id ? ' home-carousel-card--loading' : ''}`}
            onClick={() => handleTrendingClick(v)}
          >
            <div className="home-carousel-thumb home-carousel-thumb--video">
              <img src={v.thumbnail} alt={v.title} className="home-carousel-thumb-img" />
              {v.duration_seconds != null && (
                <span className="home-carousel-duration">{formatVideoDuration(v.duration_seconds)}</span>
              )}
            </div>
            <div className="home-carousel-info">
              <span className="home-carousel-title">{v.title}</span>
              <span className="home-carousel-channel">{v.channel}</span>
            </div>
          </div>
        )}
      />

      {/* Section 2b: Recommended Channels */}
      {targetLang && (
        <Carousel<ChannelSummary>
          title="Recommended Channels"
          subtitle={`curated ${langName} content creators`}
          items={channels}
          loading={channelsLoading}
          renderSkeleton={() => (
            <div className="home-carousel-card home-channel-card home-carousel-card--skeleton">
              <div className="home-channel-stack home-carousel-thumb--skeleton" />
              <div className="home-carousel-info">
                <div className="home-skeleton-line" style={{ width: '70%' }} />
              </div>
            </div>
          )}
          renderItem={(ch) => (
            <div
              key={ch.handle}
              className="home-carousel-card home-channel-card home-carousel-card--clickable"
              onClick={() => navigate(`/channel/${ch.handle}`)}
            >
              <div className="home-channel-stack">
                {ch.thumbnails.slice(0, 3).reverse().map((thumb, i, arr) => (
                  <img
                    key={i}
                    src={thumb}
                    alt=""
                    className={`home-channel-stack-img home-channel-stack-img--${arr.length - 1 - i}`}
                  />
                ))}
              </div>
              <div className="home-carousel-info">
                <span className="home-carousel-title">{ch.name}</span>
              </div>
            </div>
          )}
        />
      )}

      {/* Section 3: News for you */}
      <Carousel<NewsArticle>
        title="News for you"
        subtitle={`headlines in ${langName || 'your target language'}`}
        items={news}
        loading={newsLoading}
        emptyState={
          !targetLang ? (
            <div className="home-empty-state">
              <p>Set a target language in Settings to see news headlines.</p>
            </div>
          ) : (
            <div className="home-empty-state">
              <p>No news articles available right now.</p>
            </div>
          )
        }
        renderSkeleton={() => (
          <div className="home-carousel-card home-carousel-card--skeleton">
            <div className="home-carousel-thumb home-carousel-thumb--news home-carousel-thumb--skeleton" />
            <div className="home-carousel-info">
              <div className="home-skeleton-line" style={{ width: '80%' }} />
              <div className="home-skeleton-line" style={{ width: '50%' }} />
            </div>
          </div>
        )}
        renderItem={(n, i) => (
          <div
            key={i}
            className="home-carousel-card home-carousel-card--clickable"
            onClick={() => navigate(`/read/${targetLang}/${i}`)}
          >
            {n.image && (
              <div className="home-carousel-thumb home-carousel-thumb--news">
                <img src={n.image} alt="" className="home-carousel-thumb-img" />
                <span className="home-news-source-overlay">{n.source}</span>
              </div>
            )}
            <div className="home-carousel-info">
              {!n.image && <span className="home-carousel-source">{n.source}</span>}
              <span className="home-carousel-title">{n.simplified_title}</span>
              <div className="home-carousel-meta">
                {n.difficulty && (
                  <span className="home-difficulty-pill" style={{ background: CEFR_COLORS[n.difficulty] || '#3b82f6' }}>
                    {n.difficulty}
                  </span>
                )}
                {n.words.map((w) => (
                  <span key={w.word} className="home-word-badge">{w.word}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      />

      {showAddVideo && (
        <AddVideoModal onClose={() => setShowAddVideo(false)} onAdded={() => {}} />
      )}
    </div>
  );
}
