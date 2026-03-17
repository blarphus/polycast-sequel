// ---------------------------------------------------------------------------
// pages/Channel.tsx -- Detail page for a curated YouTube channel
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getChannelVideos, TrendingVideo } from '../api';
import { ChevronLeftIcon } from '../components/icons';
import { VideoGridCard, VideoGridSkeleton } from '../components/video/VideoGridCard';
import { useVideoClick } from '../hooks/useVideoClick';
import { filterUnplayableVideos } from '../utils/playabilityFilter';

export default function Channel() {
  const { handle } = useParams<{ handle: string }>();
  const navigate = useNavigate();
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
            <VideoGridSkeleton key={i} />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="home-empty-state">
          <p>No videos available for this channel.</p>
        </div>
      ) : (
        <div className="browse-grid">
          {videos.map((v) => (
            <VideoGridCard
              key={v.youtube_id}
              video={v}
              loading={addingVideoId === v.youtube_id}
              showCaptions
              onClick={() => handleVideoClick(v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
