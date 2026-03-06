import { useCallback, useEffect, useState } from 'react';
import {
  fetchTranscriptFromWorker,
  getVideo,
  retryVideoTranscript,
  uploadTranscript,
  type VideoDetail,
} from '../api';

export function useWatchVideoData(id: string | undefined) {
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryingTranscript, setRetryingTranscript] = useState(false);
  const [clientFetching, setClientFetching] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);

    getVideo(id)
      .then((nextVideo) => {
        if (!cancelled) setVideo(nextVideo);
      })
      .catch((err) => {
        console.error('Failed to fetch video:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id || !video || video.transcript_status !== 'processing') return;

    const timer = setInterval(() => {
      getVideo(id)
        .then((nextVideo) => setVideo(nextVideo))
        .catch((err) => {
          console.error('Failed to refresh video transcript status:', err);
        });
    }, 4000);

    return () => clearInterval(timer);
  }, [id, video?.transcript_status]);

  useEffect(() => {
    if (!video || !id) return;
    const hasTranscript = Array.isArray(video.transcript) && video.transcript.length > 0;
    if (hasTranscript || video.transcript_status === 'ready' || clientFetching) return;

    let cancelled = false;
    setClientFetching(true);

    fetchTranscriptFromWorker(video.youtube_id, video.language)
      .then((segments) => {
        if (cancelled) return;
        return uploadTranscript(id, segments);
      })
      .then((updated) => {
        if (cancelled || !updated) return;
        setVideo(updated);
      })
      .catch((err) => {
        console.error('[client-fetch] CF Worker transcript fetch failed:', err);
      })
      .finally(() => {
        if (!cancelled) setClientFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, video?.transcript_status, video?.youtube_id, video?.language, clientFetching]);

  const handleRetryTranscript = useCallback(async () => {
    if (!id) return;
    setRetryingTranscript(true);
    try {
      const updated = await retryVideoTranscript(id);
      setVideo(updated);
    } catch (err) {
      console.error('Failed to retry transcript fetch:', err);
    } finally {
      setRetryingTranscript(false);
    }
  }, [id]);

  const hasTranscript = Array.isArray(video?.transcript) && video.transcript.length > 0;

  return {
    video,
    loading,
    error,
    retryingTranscript,
    handleRetryTranscript,
    hasTranscript,
  };
}
