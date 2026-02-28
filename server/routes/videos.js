import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';
import { YoutubeTranscript } from 'youtube-transcript';

const router = Router();

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
