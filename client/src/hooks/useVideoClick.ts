import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addVideo, TrendingVideo } from '../api';

export function useVideoClick(targetLang: string) {
  const navigate = useNavigate();
  const [addingVideoId, setAddingVideoId] = useState<string | null>(null);

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

  return { addingVideoId, handleVideoClick };
}
