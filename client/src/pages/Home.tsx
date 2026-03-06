// ---------------------------------------------------------------------------
// pages/Home.tsx -- Central learning hub (default landing page)
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getNewToday, getTrendingVideos, getNews, getChannels, getDueWords, getClassesToday, getFriends, SavedWord, TrendingVideo, NewsArticle, ChannelSummary, UpcomingClass, Friend } from '../api';
import { proxyImageUrl } from '../api/dictionary';
import { LANGUAGES } from '../components/classwork/languages';
import { LANGUAGE_BANNERS } from '../utils/languageBanners';
import FriendRequests from '../components/FriendRequests';
import PendingClasswork from '../components/PendingClasswork';
import AddVideoModal from '../components/AddVideoModal';
import Carousel from '../components/Carousel';
import ChannelCard from '../components/cards/ChannelCard';
import { FrequencyDots } from '../components/FrequencyDots';
import { CalendarIcon } from '../components/icons';
import { formatVideoDuration, CEFR_COLORS } from '../utils/videoFormat';
import { formatUsTime } from '../utils/dateFormat';
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
  const [friends, setFriends] = useState<Friend[]>([]);
  const [srsCounts, setSrsCounts] = useState({ new: 0, learning: 0, review: 0 });
  const [classesToday, setClassesToday] = useState<UpcomingClass[]>([]);

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

    getDueWords()
      .then((words) => {
        if (cancelled) return;
        let n = 0, l = 0, r = 0;
        for (const w of words) {
          if (w.srs_interval === 0 && w.learning_step === null && !w.last_reviewed_at) n++;
          else if (w.learning_step !== null) l++;
          else r++;
        }
        setSrsCounts({ new: n, learning: l, review: r });
      })
      .catch((err) => console.error('Failed to fetch due words:', err));

    getFriends()
      .then((f) => { if (!cancelled) setFriends(f); })
      .catch((err) => console.error('Failed to fetch friends:', err));

    getClassesToday()
      .then(({ classes: c }) => { if (!cancelled) setClassesToday(c); })
      .catch((err) => console.error('Failed to fetch today\'s classes:', err));

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

  // Hero banner background
  const bannerImg = targetLang ? LANGUAGE_BANNERS[targetLang] : null;
  const bannerStyle: React.CSSProperties = bannerImg
    ? { backgroundImage: `url(${bannerImg})` }
    : { background: 'linear-gradient(135deg, var(--accent), #a78bfa)' };

  // Featured word: first word with an image
  const featuredWord = newWords.find((w) => w.image_url);
  const remainingWords = featuredWord ? newWords.filter((w) => w.id !== featuredWord.id) : newWords;

  // Friends online
  const onlineFriends = friends.filter((f) => f.online);

  // Next class
  const nextClass = classesToday[0];

  return (
    <div className="home-page">
      {/* Pending friend requests */}
      <FriendRequests />

      {/* Pending classwork (students only) */}
      {user?.account_type === 'student' && <PendingClasswork />}

      {/* Hero banner */}
      <div className="home-banner" style={bannerStyle}>
        <div className="home-banner-overlay" />
        <div className="home-banner-content">
          <h1 className="home-banner-title">Welcome back, {firstName}</h1>
          <p className="home-banner-subtitle">
            {langName ? `Exploring ${langName}` : 'Ready to learn something new?'}
          </p>
          <button className="home-banner-cta" onClick={() => navigate('/learn')}>
            Start learning
          </button>
        </div>
      </div>

      {/* Dashboard grid */}
      <div className="home-dashboard-grid">
        {/* Card 1: New Words Today (7 cols) */}
        <div className="home-dashboard-card home-card--words">
          <div className="home-dashboard-label">New words today</div>

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
            <>
              {featuredWord && (
                <div className="home-featured-word">
                  {featuredWord.image_url && (
                    <img
                      src={proxyImageUrl(featuredWord.image_url)!}
                      alt={featuredWord.word}
                      className="home-featured-word-img"
                    />
                  )}
                  <div className="home-featured-word-text">
                    <span className="home-featured-word-label">New word</span>
                    <span className="home-featured-word-word">{featuredWord.word}</span>
                    <span className="home-featured-word-translation">{featuredWord.translation}</span>
                  </div>
                </div>
              )}
              <div className="home-words-list">
                {remainingWords.map((w) => (
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
            </>
          )}
        </div>

        {/* Card 2: News for You (5 cols) */}
        <div className="home-dashboard-card home-card--news">
          <div className="home-dashboard-label">News for you</div>
          {newsLoading ? (
            <div className="home-words-list">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="home-word-row home-word-row--skeleton" />
              ))}
            </div>
          ) : news.length === 0 ? (
            <div className="home-empty-state">
              <p>{!targetLang ? 'Set a target language in Settings to see news.' : 'No news articles available right now.'}</p>
            </div>
          ) : (
            <>
              {news.slice(0, 3).map((n, i) => (
                <div
                  key={i}
                  className="home-news-item"
                  onClick={() => navigate(`/read/${targetLang}/${i}`)}
                >
                  <span className="home-news-item-title">{n.simplified_title}</span>
                  <div className="home-news-item-meta">
                    <span className="home-news-item-source">{n.source}</span>
                    {n.difficulty && (
                      <span className="home-difficulty-pill" style={{ background: CEFR_COLORS[n.difficulty] || '#3b82f6' }}>
                        {n.difficulty}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {news.length > 3 && (
                <button
                  className="home-news-see-all"
                  onClick={() => {
                    const newsSection = document.querySelector('.home-news-carousel');
                    newsSection?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  See all {news.length} articles
                </button>
              )}
            </>
          )}
        </div>

        {/* Card 3: Next Class (6 cols) */}
        <div className="home-dashboard-card home-card--class">
          <div className="home-dashboard-label">Next class</div>
          {nextClass ? (
            <div className="home-class-row">
              <div className="home-class-icon">
                <CalendarIcon size={20} />
              </div>
              <div className="home-class-info">
                <span className="home-class-name">{nextClass.title || 'Class Session'}</span>
                <span className="home-class-meta">
                  {nextClass.time || (nextClass.scheduled_at ? formatUsTime(nextClass.scheduled_at) : '')}
                  {nextClass.duration_minutes ? ` \u00b7 ${nextClass.duration_minutes} min` : ''}
                  {nextClass.teacher_name ? ` \u00b7 ${nextClass.teacher_name}` : ''}
                </span>
              </div>
              <button className="home-class-join" onClick={() => navigate(`/group-call/${nextClass.id}`)}>
                Join
              </button>
            </div>
          ) : (
            <p className="home-class-empty">No classes scheduled today</p>
          )}
        </div>

        {/* Card 4: Friends Online (3 cols) */}
        <div className="home-dashboard-card home-card--friends">
          <div className="home-dashboard-label">Friends</div>
          <div className="home-square-card-content" onClick={() => navigate('/chats')}>
            <div className="home-friend-avatars">
              {onlineFriends.slice(0, 3).map((f) => (
                <div key={f.id} className="home-friend-avatar">
                  {(f.display_name || f.username).charAt(0).toUpperCase()}
                </div>
              ))}
              {onlineFriends.length > 3 && (
                <div className="home-friend-avatar home-friend-avatar--overflow">
                  +{onlineFriends.length - 3}
                </div>
              )}
              {onlineFriends.length === 0 && (
                <div className="home-friend-avatar" style={{ opacity: 0.4 }}>-</div>
              )}
            </div>
            <span className="home-square-count">{onlineFriends.length}</span>
            <span className="home-square-sublabel">online</span>
          </div>
        </div>

        {/* Card 5: SRS Counts (3 cols) */}
        <div className="home-dashboard-card home-card--practice">
          <div className="home-dashboard-label">Flashcards</div>
          {(() => {
            const total = srsCounts.new + srsCounts.learning + srsCounts.review;
            return (
              <div className="home-srs-card-content" onClick={() => navigate('/learn')}>
                {total === 0 ? (
                  <span className="home-srs-caught-up">All caught up!</span>
                ) : (
                  <div className="home-srs-rows">
                    <div className="home-srs-row">
                      <span className="home-srs-label">New:</span>
                      <span className="home-srs-value home-srs-value--new">{srsCounts.new}</span>
                    </div>
                    <div className="home-srs-row">
                      <span className="home-srs-label">Learning:</span>
                      <span className="home-srs-value home-srs-value--learning">{srsCounts.learning}</span>
                    </div>
                    <div className="home-srs-row">
                      <span className="home-srs-label">To Review:</span>
                      <span className="home-srs-value home-srs-value--review">{srsCounts.review}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
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
            <ChannelCard
              key={ch.handle}
              channel={ch}
              onClick={() => navigate(`/channel/${ch.handle}`)}
            />
          )}
        />
      )}

      {/* Section 3: News for you (full carousel) */}
      <div className="home-news-carousel">
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
              className={`home-carousel-card home-carousel-card--clickable home-carousel-card--news${n.image ? '' : ' home-carousel-card--no-thumb'}`}
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
      </div>

      {showAddVideo && (
        <AddVideoModal onClose={() => setShowAddVideo(false)} onAdded={() => {}} />
      )}
    </div>
  );
}
