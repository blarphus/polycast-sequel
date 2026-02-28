import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';
import { YoutubeTranscript } from 'youtube-transcript';

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

/**
 * Decode common HTML entities that youtube-transcript returns.
 */
function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/**
 * GET /api/videos
 * List all videos (summary — no transcript).
 */
router.get('/api/videos', authMiddleware, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, youtube_id, title, channel, language, duration_seconds
       FROM videos ORDER BY created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/videos failed:', err);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

/**
 * POST /api/videos
 * Create a new video from a YouTube URL.
 */
router.post('/api/videos', authMiddleware, async (req, res) => {
  try {
    const { url, language = 'en' } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const youtube_id = parseYouTubeId(url);
    if (!youtube_id) return res.status(400).json({ error: 'Invalid YouTube URL' });

    // Duplicate check — return existing video
    const existing = await pool.query('SELECT * FROM videos WHERE youtube_id = $1', [youtube_id]);
    if (existing.rows.length > 0) return res.json(existing.rows[0]);

    // Fetch metadata from YouTube Data API
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

    // Eagerly fetch transcript
    let transcript = null;
    try {
      const segments = await YoutubeTranscript.fetchTranscript(youtube_id);
      transcript = JSON.stringify(
        segments.map((s) => ({
          text: decodeEntities(s.text),
          offset: s.offset,
          duration: s.duration,
        })),
      );
    } catch (transcriptErr) {
      console.error(`Transcript fetch failed for ${youtube_id}:`, transcriptErr.message);
    }

    const { rows } = await pool.query(
      `INSERT INTO videos (youtube_id, title, channel, language, duration_seconds, transcript)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [youtube_id, title, channel, language, duration_seconds, transcript],
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /api/videos failed:', err);
    res.status(500).json({ error: 'Failed to add video' });
  }
});

/**
 * GET /api/videos/:id
 * Return full video detail including transcript.
 * If transcript is NULL, lazy-fetch from YouTube and cache.
 */
router.get('/api/videos/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query('SELECT * FROM videos WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const video = rows[0];

    // Lazy-fetch transcript if not cached
    if (video.transcript === null) {
      try {
        const segments = await YoutubeTranscript.fetchTranscript(video.youtube_id);
        const cleaned = segments.map((s) => ({
          text: decodeEntities(s.text),
          offset: s.offset,
          duration: s.duration,
        }));

        await pool.query(
          'UPDATE videos SET transcript = $1 WHERE id = $2',
          [JSON.stringify(cleaned), id],
        );
        video.transcript = cleaned;
      } catch (transcriptErr) {
        console.error(`Transcript fetch failed for video ${id}:`, transcriptErr.message);
        video.transcript_error = 'Transcript temporarily unavailable';
      }
    }

    res.json(video);
  } catch (err) {
    console.error('GET /api/videos/:id failed:', err);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

export default router;
