import { Router } from 'express';
import pool from '../db.js';
import redisClient from '../redis.js';
import { authMiddleware } from '../auth.js';
import { enqueueTranscriptJob } from '../services/videoTranscriptQueue.js';

const router = Router();

/**
 * Extract a YouTube video ID from common URL formats.
 */
function parseYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Convert ISO 8601 duration (e.g. PT4M13S) to seconds.
 */
function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (parseInt(m[1] || '0', 10) * 3600) +
         (parseInt(m[2] || '0', 10) * 60) +
         parseInt(m[3] || '0', 10);
}

function attachTranscriptError(video) {
  const out = { ...video };
  const hasTranscript = Array.isArray(out.transcript)
    ? out.transcript.length > 0
    : Boolean(out.transcript);
  const status = out.transcript_status || (hasTranscript ? 'ready' : 'missing');
  out.transcript_status = status;

  if (!out.transcript_source) {
    out.transcript_source = hasTranscript ? 'manual' : 'none';
  }

  if (status === 'failed') {
    out.transcript_error = out.transcript_last_error || 'Transcript temporarily unavailable';
  }

  return out;
}

async function fetchVideoById(id) {
  const { rows } = await pool.query('SELECT * FROM videos WHERE id = $1', [id]);
  return rows[0] || null;
}

async function queueTranscriptIfNeeded(video, opts = {}) {
  const { force = false } = opts;

  if (!video) return null;

  const hasTranscript = Array.isArray(video.transcript) && video.transcript.length > 0;
  if (!force && hasTranscript && video.transcript_status === 'ready') {
    return attachTranscriptError(video);
  }

  if (!force && video.transcript_status === 'processing') {
    return attachTranscriptError(video);
  }

  const { rows: updatedRows } = await pool.query(
    `UPDATE videos
     SET transcript_status = 'processing',
         transcript_last_error = NULL,
         transcript_updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [video.id],
  );

  const updated = updatedRows[0] || video;
  const enqueueResult = await enqueueTranscriptJob(
    redisClient,
    {
      videoId: updated.id,
      youtubeId: updated.youtube_id,
      language: updated.language,
      attempt: 1,
    },
    { force },
  );

  if (!enqueueResult.accepted && enqueueResult.reason === 'redis_unavailable') {
    const { rows: failedRows } = await pool.query(
      `UPDATE videos
       SET transcript_status = 'failed',
           transcript_source = 'none',
           transcript_last_error = 'Transcript queue unavailable. Please try again later.',
           transcript_updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [video.id],
    );
    return attachTranscriptError(failedRows[0] || updated);
  }

  return attachTranscriptError(updated);
}

/**
 * GET /api/videos
 * List all videos (summary).
 */
router.get('/api/videos', authMiddleware, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, youtube_id, title, channel, language, duration_seconds,
              transcript_status, transcript_source
       FROM videos ORDER BY created_at DESC`,
    );
    res.json(rows.map(attachTranscriptError));
  } catch (err) {
    console.error('GET /api/videos failed:', err);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

/**
 * POST /api/videos
 * Create a new video from a YouTube URL, then queue transcript extraction.
 */
router.post('/api/videos', authMiddleware, async (req, res) => {
  try {
    const { url, language = 'en' } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const youtube_id = parseYouTubeId(url);
    if (!youtube_id) return res.status(400).json({ error: 'Invalid YouTube URL' });

    // Duplicate check — return existing video and ensure queued if transcript missing.
    const existing = await pool.query('SELECT * FROM videos WHERE youtube_id = $1', [youtube_id]);
    if (existing.rows.length > 0) {
      const existingVideo = existing.rows[0];

      if (!existingVideo.transcript &&
          (!existingVideo.transcript_status || existingVideo.transcript_status === 'missing')) {
        const queued = await queueTranscriptIfNeeded(existingVideo);
        return res.json(queued || attachTranscriptError(existingVideo));
      }

      return res.json(attachTranscriptError(existingVideo));
    }

    // Fetch metadata from YouTube Data API.
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error('POST /api/videos: YOUTUBE_API_KEY not set');
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const metaUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${youtube_id}&key=${apiKey}`;
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) {
      const body = await metaRes.text();
      console.error('YouTube Data API error:', metaRes.status, body);
      return res.status(502).json({ error: 'Failed to fetch video metadata from YouTube' });
    }

    const metaData = await metaRes.json();
    if (!metaData.items || metaData.items.length === 0) {
      return res.status(404).json({ error: 'Video not found on YouTube' });
    }

    const item = metaData.items[0];
    const title = item.snippet.title;
    const channel = item.snippet.channelTitle;
    const duration_seconds = parseDuration(item.contentDetails.duration);

    const { rows } = await pool.query(
      `INSERT INTO videos (youtube_id, title, channel, language, duration_seconds)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [youtube_id, title, channel, language, duration_seconds],
    );

    const queued = await queueTranscriptIfNeeded(rows[0]);
    res.status(201).json(queued || attachTranscriptError(rows[0]));
  } catch (err) {
    console.error('POST /api/videos failed:', err);
    res.status(500).json({ error: 'Failed to add video' });
  }
});

/**
 * GET /api/videos/:id
 * Return full video detail including transcript lifecycle status.
 */
router.get('/api/videos/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    let video = await fetchVideoById(id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const hasTranscript = Array.isArray(video.transcript) && video.transcript.length > 0;

    // Keep lifecycle status consistent for older rows, but do not override active processing retries.
    if (hasTranscript &&
        video.transcript_status !== 'ready' &&
        video.transcript_status !== 'processing') {
      const { rows } = await pool.query(
        `UPDATE videos
         SET transcript_status = 'ready',
             transcript_source = CASE WHEN transcript_source = 'none' THEN 'manual' ELSE transcript_source END,
             transcript_last_error = NULL,
             transcript_updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id],
      );
      video = rows[0] || video;
    }

    // Queue background extraction on cache miss.
    if (!hasTranscript && (!video.transcript_status || video.transcript_status === 'missing')) {
      video = await queueTranscriptIfNeeded(video) || video;
    }

    res.json(attachTranscriptError(video));
  } catch (err) {
    console.error('GET /api/videos/:id failed:', err);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

/**
 * POST /api/videos/:id/transcript/retry
 * Force a new background transcript extraction attempt.
 */
router.post('/api/videos/:id/transcript/retry', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const video = await fetchVideoById(id);
    if (!video) return res.status(404).json({ error: 'Video not found' });

    const queued = await queueTranscriptIfNeeded(video, { force: true });
    if (!queued) return res.status(500).json({ error: 'Failed to queue transcript retry' });

    res.json(queued);
  } catch (err) {
    console.error('POST /api/videos/:id/transcript/retry failed:', err);
    res.status(500).json({ error: 'Failed to retry transcript extraction' });
  }
});

export default router;
