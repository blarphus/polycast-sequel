// ---------------------------------------------------------------------------
// pages/Channel.tsx -- Detail page for a curated YouTube channel
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getChannelVideos, TrendingVideo } from '../api';
import { ChevronLeftIcon } from '../components/icons';
import { formatVideoDuration } from '../utils/videoFormat';
import { useVideoClick } from '../hooks/useVideoClick';
import { filterUnplayableVideos } from '../utils/playabilityFilter';

export default function Channel() {
  const { handle } = useParams<{ handle: string }>();
  const { user } = useAuth();

  const [channelName, setChannelName] = useState('');
  const [videos, setVideos] = useState<TrendingVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const targetLang = user?.target_language || 'en';
  const { addingVideoId, handleVideoClick } = useVideoClick(targetLang);

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    getChannelVideos(handle, targetLang)
      .then((data) => {
        if (cancelled) return;
        setChannelName(data.channel.name);
        setVideos(data.videos);
        filterUnplayableVideos(data.videos, setVideos);
      })
      .catch((err) => {
        console.error('Failed to fetch channel videos:', err);
        if (!cancelled) setError('Failed to load channel videos. Please try again.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [handle, targetLang]);

  return (
    <div className="browse-page">
      <button className="channel-back-btn" onClick={() => history.back()}>
        <ChevronLeftIcon size={18} />
        Back
      </button>

      <h2 className="browse-section-title">{channelName || 'Channel'}</h2>

      {error ? (
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
          <p>No videos available for this channel.</p>
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
                  <span className="browse-card-duration">{formatVideoDuration(v.duration_seconds)}</span>
                )}
              </div>
              <div className="browse-card-info">
                <span className="browse-card-title">{v.title}</span>
                <span className="browse-card-channel">{v.channel}</span>
                <span className={`browse-card-captions${v.has_captions ? ' browse-card-captions--human' : ''}`}>
                  {v.has_captions ? 'Human captions' : 'Auto captions'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
