import { Router } from 'express';
import pool from '../db.js';
import redisClient from '../redis.js';
import { authMiddleware } from '../auth.js';
import { enqueueTranscriptJob, markReady, clearTranscriptDedupe } from '../services/videoTranscriptQueue.js';
import { fetchYouTubeTranscript } from '../services/videoTranscriptFetcher.js';

const router = Router();

// YouTube Movies & TV channel — free full-length films with professional captions
const MOVIES_TV_CHANNEL_ID = 'UCuVPpxrm2VAgpH3Ktln4HXg';
const MOVIES_TV_UPLOADS_PLAYLIST = 'UUuVPpxrm2VAgpH3Ktln4HXg'; // UC → UU = uploads playlist

const LANG_TO_REGION = {
  en: 'US', es: 'ES', fr: 'FR', de: 'DE', it: 'IT', pt: 'BR',
  ru: 'RU', zh: 'TW', ja: 'JP', ko: 'KR', ar: 'EG', hi: 'IN',
  tr: 'TR', pl: 'PL', nl: 'NL', sv: 'SE', da: 'DK', fi: 'FI',
  uk: 'UA', vi: 'VN',
};

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
              transcript_status, transcript_source, cefr_level, transcript_progress
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
 * Fetch free movies & TV from YouTube's dedicated channel (English only).
 * Step 1: playlistItems.list to get video IDs (1 quota unit)
 * Step 2: videos.list for details + caption filtering (1 quota unit)
 */
async function fetchMoviesAndTV(apiKey) {
  const plUrl =
    `https://www.googleapis.com/youtube/v3/playlistItems` +
    `?part=contentDetails&playlistId=${MOVIES_TV_UPLOADS_PLAYLIST}` +
    `&maxResults=50&key=${apiKey}`;

  const plRes = await fetch(plUrl);
  if (!plRes.ok) {
    const body = await plRes.text();
    console.error('YouTube Movies & TV playlist API error:', plRes.status, body);
    throw new Error('Failed to fetch Movies & TV playlist from YouTube');
  }

  const plData = await plRes.json();
  const videoIds = (plData.items || [])
    .map((item) => item.contentDetails.videoId)
    .filter(Boolean);

  if (videoIds.length === 0) {
    throw new Error('Movies & TV playlist returned no videos');
  }

  const detailUrl =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,contentDetails,status&id=${videoIds.join(',')}` +
    `&key=${apiKey}`;

  const detailRes = await fetch(detailUrl);
  if (!detailRes.ok) {
    const body = await detailRes.text();
    console.error('YouTube video details API error:', detailRes.status, body);
    throw new Error('Failed to fetch video details from YouTube');
  }

  const detailData = await detailRes.json();
  return (detailData.items || [])
    .filter((item) => item.contentDetails.caption === 'true')
    .filter((item) => item.contentDetails.contentRating?.ytRating !== 'ytAgeRestricted')
    .filter((item) => item.status?.embeddable !== false)
    .map((item) => ({
      youtube_id: item.id,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url ||
                 `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`,
      duration_seconds: parseDuration(item.contentDetails.duration),
      published_at: item.snippet.publishedAt,
    }));
}

/**
 * GET /api/videos/trending
 * Return top trending YouTube videos for a language-region.
 * For English: returns free Movies & TV with captions instead.
 * Cached in Redis for 6 hours.
 */
router.get('/api/videos/trending', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const regionCode = LANG_TO_REGION[lang] || 'US';
    const isEnglish = lang === 'en';
    const cacheKey = isEnglish ? 'trending:en:movies' : `trending:${lang}`;

    // Try Redis cache first
    let cached = null;
    try {
      if (redisClient.isReady) {
        cached = await redisClient.get(cacheKey);
      }
    } catch (cacheErr) {
      console.warn('Redis read failed for trending cache:', cacheErr.message);
    }

    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Cache miss — fetch from YouTube Data API
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error('GET /api/videos/trending: YOUTUBE_API_KEY not set');
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    let items;

    if (isEnglish) {
      items = await fetchMoviesAndTV(apiKey);
    } else {
      const ytUrl =
        `https://www.googleapis.com/youtube/v3/videos` +
        `?part=snippet,contentDetails,status&chart=mostPopular` +
        `&regionCode=${regionCode}&maxResults=50&key=${apiKey}`;

      const ytRes = await fetch(ytUrl);
      if (!ytRes.ok) {
        const body = await ytRes.text();
        console.error('YouTube trending API error:', ytRes.status, body);
        return res.status(502).json({ error: 'Failed to fetch trending videos from YouTube' });
      }

      const ytData = await ytRes.json();
      items = (ytData.items || [])
        .filter((item) => item.contentDetails.caption === 'true')
        .filter((item) => item.contentDetails.contentRating?.ytRating !== 'ytAgeRestricted')
        .filter((item) => item.status?.embeddable !== false)
        .map((item) => ({
          youtube_id: item.id,
          title: item.snippet.title,
          channel: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails?.medium?.url ||
                     `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`,
          duration_seconds: parseDuration(item.contentDetails.duration),
          published_at: item.snippet.publishedAt,
        }));
    }

    // Cache in Redis for 6 hours
    try {
      if (redisClient.isReady) {
        await redisClient.set(cacheKey, JSON.stringify(items), { EX: 21600 });
      }
    } catch (cacheErr) {
      console.warn('Redis write failed for trending cache:', cacheErr.message);
    }

    res.json(items);
  } catch (err) {
    console.error('GET /api/videos/trending failed:', err);
    res.status(500).json({ error: 'Failed to fetch trending videos' });
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

/**
 * PUT /api/videos/:id/transcript
 * Accept a client-uploaded transcript (fetched via CF Worker in the browser).
 */
router.put('/api/videos/:id/transcript', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const video = await fetchVideoById(id);
    if (!video) return res.status(404).json({ error: 'Video not found' });

    // If already ready with transcript, return as-is (idempotent)
    const hasTranscript = Array.isArray(video.transcript) && video.transcript.length > 0;
    if (video.transcript_status === 'ready' && hasTranscript) {
      return res.json(attachTranscriptError(video));
    }

    // Validate segments
    const { segments } = req.body;
    if (!Array.isArray(segments) || segments.length === 0 || segments.length > 10000) {
      return res.status(400).json({ error: 'segments must be a non-empty array (max 10,000 items)' });
    }
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg || typeof seg.text !== 'string' || !seg.text.trim() || seg.text.length > 2000) {
        return res.status(400).json({ error: `segments[${i}].text must be a non-empty string (max 2000 chars)` });
      }
      if (typeof seg.offset !== 'number' || !Number.isFinite(seg.offset) || seg.offset < 0) {
        return res.status(400).json({ error: `segments[${i}].offset must be a finite number >= 0` });
      }
      if (typeof seg.duration !== 'number' || !Number.isFinite(seg.duration) || seg.duration < 0) {
        return res.status(400).json({ error: `segments[${i}].duration must be a finite number >= 0` });
      }
    }

    // Normalize
    const normalized = segments.map((seg) => ({
      text: seg.text.trim(),
      offset: Math.round(seg.offset),
      duration: Math.round(seg.duration),
    }));

    await markReady(pool, video.id, normalized, 'client_upload', video.transcript_attempts || 1, video.language);
    await clearTranscriptDedupe(redisClient, video.id, video.language);

    const updated = await fetchVideoById(id);
    res.json(attachTranscriptError(updated));
  } catch (err) {
    console.error('PUT /api/videos/:id/transcript failed:', err);
    res.status(500).json({ error: 'Failed to upload transcript' });
  }
});

export default router;
