// ---------------------------------------------------------------------------
// pages/Channel.tsx -- Detail page for a curated YouTube channel
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getChannelVideos, addVideo, checkVideoPlayability, TrendingVideo } from '../api';
import { ChevronLeftIcon } from '../components/icons';

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Channel() {
  const { handle } = useParams<{ handle: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [channelName, setChannelName] = useState('');
  const [videos, setVideos] = useState<TrendingVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addingVideoId, setAddingVideoId] = useState<string | null>(null);

  const targetLang = user?.target_language || 'en';

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
        // Two-phase: show immediately, then filter age-restricted
        const ids = data.videos.map((v) => v.youtube_id);
        if (ids.length > 0) {
          checkVideoPlayability(ids)
            .then((blocked) => {
              if (!cancelled && blocked.size > 0) {
                setVideos((prev) => prev.filter((v) => !blocked.has(v.youtube_id)));
              }
            })
            .catch((err) => console.error('Playability check failed:', err));
        }
      })
      .catch((err) => {
        console.error('Failed to fetch channel videos:', err);
        if (!cancelled) setError('Failed to load channel videos. Please try again.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [handle, targetLang]);

  async function handleVideoClick(video: TrendingVideo) {
    if (addingVideoId) return;
    setAddingVideoId(video.youtube_id);
    try {
      const url = `https://www.youtube.com/watch?v=${video.youtube_id}`;
      const added = await addVideo(url, targetLang);
      navigate(`/watch/${added.id}`);
    } catch (err) {
      console.error('Failed to add video:', err);
      setAddingVideoId(null);
    }
  }

  return (
    <div className="browse-page">
      <button className="channel-back-btn" onClick={() => navigate(-1)}>
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
                  <span className="browse-card-duration">{formatDuration(v.duration_seconds)}</span>
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
