import { Router } from 'express';
import { XMLParser } from 'fast-xml-parser';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';

const router = Router();

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

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
 * Decode common HTML entities that YouTube captions return.
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
 * Fetch transcript via YouTube's innertube API (avoids page-scraping rate limits).
 * 1. Calls innertube player endpoint to discover caption track URLs.
 * 2. Fetches the timedtext XML for the first matching track.
 * 3. Parses XML into [{text, offset, duration}] segments.
 */
async function fetchTranscript(youtubeId, lang = 'en') {
  // Step 1 — get caption track URLs from innertube player API
  const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId: youtubeId,
      context: {
        client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30 },
      },
    }),
  });
  if (!playerRes.ok) throw new Error(`innertube player returned ${playerRes.status}`);

  const playerData = await playerRes.json();
  const tracks =
    playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) throw new Error('No caption tracks available');

  // Prefer exact language match, then any track
  const track = tracks.find((t) => t.languageCode === lang) ?? tracks[0];

  // Step 2 — fetch the timedtext XML
  const ttRes = await fetch(track.baseUrl);
  if (!ttRes.ok) throw new Error(`timedtext returned ${ttRes.status}`);
  const xml = await ttRes.text();

  // Step 3 — parse XML into segments
  const parsed = xmlParser.parse(xml);
  const body = parsed?.timedtext?.body;
  if (!body) throw new Error('Unexpected timedtext XML structure');

  // body.p can be a single object or an array
  const paragraphs = Array.isArray(body.p) ? body.p : body.p ? [body.p] : [];

  return paragraphs.map((p) => {
    // Collect text from <s> children (word-level segments)
    let text;
    if (p.s) {
      const segs = Array.isArray(p.s) ? p.s : [p.s];
      text = segs.map((s) => (typeof s === 'string' ? s : s['#text'] ?? '')).join('');
    } else {
      text = typeof p === 'string' ? p : p['#text'] ?? '';
    }
    return {
      text: decodeEntities(text.trim()),
      offset: Number(p['@_t'] ?? 0),
      duration: Number(p['@_d'] ?? 0),
    };
  }).filter((s) => s.text);
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
      const segments = await fetchTranscript(youtube_id, language);
      transcript = JSON.stringify(segments);
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
        const segments = await fetchTranscript(video.youtube_id, video.language);

        await pool.query(
          'UPDATE videos SET transcript = $1 WHERE id = $2',
          [JSON.stringify(segments), id],
        );
        video.transcript = segments;
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
