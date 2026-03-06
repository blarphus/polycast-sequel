// ---------------------------------------------------------------------------
// pages/Lesson.tsx -- Detail page for a lesson playlist (grammar topic)
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getLessonVideos, TrendingVideo } from '../api';
import { ChevronLeftIcon } from '../components/icons';
import { VideoGridCard, VideoGridSkeleton } from '../components/video/VideoGridCard';
import { useVideoClick } from '../hooks/useVideoClick';


export default function Lesson() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [lessonTitle, setLessonTitle] = useState('');
  const [videos, setVideos] = useState<TrendingVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const targetLang = user?.target_language || 'en';
  const { addingVideoId, handleVideoClick } = useVideoClick(targetLang);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    getLessonVideos(id, targetLang)
      .then((data) => {
        if (cancelled) return;
        setLessonTitle(data.lesson.title);
        setVideos(data.videos);
      })
      .catch((err) => {
        console.error('Failed to fetch lesson videos:', err);
        if (!cancelled) setError('Failed to load lesson videos. Please try again.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [id, targetLang]);

  return (
    <div className="browse-page">
      <button className="channel-back-btn" onClick={() => navigate(-1)}>
        <ChevronLeftIcon size={18} />
        Back
      </button>

      <h2 className="browse-section-title">{lessonTitle || 'Lesson'}</h2>

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
          <p>No videos available for this lesson.</p>
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
