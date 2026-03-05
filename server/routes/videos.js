import { Router } from 'express';
import { z } from 'zod';
import pool from '../db.js';
import redisClient from '../redis.js';
import { authMiddleware } from '../auth.js';
import { enqueueTranscriptJob, markReady, clearTranscriptDedupe } from '../services/videoTranscriptQueue.js';
import {
  parseDuration, parseYouTubeId, filterAndMapTrendingItems,
  fetchMoviesAndTV, fetchAllChannelVideos,
} from '../services/youtubeApi.js';
import { CHANNELS_BY_LANG } from '../data/channels.js';
import { LESSONS_BY_LANG, videoMatchesLesson, getCatalogVideos } from '../data/lessons.js';
import { cachedFetch } from '../lib/redisCache.js';
import { validate } from '../lib/validate.js';

const router = Router();

const addVideoBody = z.object({
  url: z.string().min(1, 'URL is required'),
  language: z.string().optional(),
});

const videoSearchQuery = z.object({
  q: z.string().min(1, 'Query parameter "q" is required'),
  lang: z.string().optional(),
  userRegion: z.string().optional(),
});

const LANG_TO_REGION = {
  en: 'US', es: 'ES', pt: 'BR', fr: 'FR', de: 'DE', ja: 'JP',
};

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
router.get('/api/videos', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, youtube_id, title, channel, language, duration_seconds,
              transcript_status, transcript_source, cefr_level, transcript_progress
       FROM videos ORDER BY created_at DESC`,
    );
    res.json(rows.map(attachTranscriptError));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos failed');
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

/**
 * POST /api/videos
 * Create a new video from a YouTube URL, then queue transcript extraction.
 */
router.post('/api/videos', authMiddleware, validate({ body: addVideoBody }), async (req, res) => {
  try {
    const { url, language = 'en' } = req.body;

    const youtube_id = parseYouTubeId(url);
    if (!youtube_id) return res.status(400).json({ error: 'Invalid YouTube URL' });

    // Duplicate check -- return existing video and ensure queued if transcript missing.
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
      req.log.error('POST /api/videos: YOUTUBE_API_KEY not set');
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const metaUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${youtube_id}&key=${apiKey}`;
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) {
      const body = await metaRes.text();
      req.log.error('YouTube Data API error: %d %s', metaRes.status, body);
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
    req.log.error({ err }, 'POST /api/videos failed');
    res.status(500).json({ error: 'Failed to add video' });
  }
});

/**
 * GET /api/videos/trending
 * Return top trending YouTube videos for a language-region.
 * For English: returns free Movies & TV with captions instead.
 * Cached in Redis for 6 hours.
 */
router.get('/api/videos/trending', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const trendingRegion = LANG_TO_REGION[lang] || 'US';
    // userRegion = the user's actual country (for filtering geo-restricted content)
    const userRegion = (req.query.userRegion || trendingRegion).toString().toUpperCase();
    const isEnglish = lang === 'en';
    const cacheKey = isEnglish ? `trending:en:movies:${userRegion}` : `trending2:${lang}:${userRegion}`;

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      req.log.error('GET /api/videos/trending: YOUTUBE_API_KEY not set');
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const { data: items } = await cachedFetch(cacheKey, async () => {
      if (isEnglish) {
        return await fetchMoviesAndTV(apiKey, userRegion);
      }

      // Paginate through trending results until we have enough captioned videos.
      const TARGET = 20;
      const MAX_PAGES = 4;
      const collected = [];
      let pageToken = undefined;

      for (let page = 0; page < MAX_PAGES && collected.length < TARGET; page++) {
        const ytUrl =
          `https://www.googleapis.com/youtube/v3/videos` +
          `?part=snippet,contentDetails&chart=mostPopular` +
          `&regionCode=${trendingRegion}&maxResults=50&key=${apiKey}` +
          (pageToken ? `&pageToken=${pageToken}` : '');

        const ytRes = await fetch(ytUrl);
        if (!ytRes.ok) {
          const body = await ytRes.text();
          req.log.error('YouTube trending API error: %d %s', ytRes.status, body);
          if (collected.length > 0) break;
          throw new Error('Failed to fetch trending videos from YouTube');
        }

        const ytData = await ytRes.json();
        collected.push(...filterAndMapTrendingItems(ytData.items, userRegion));
        pageToken = ytData.nextPageToken;
        if (!pageToken) break;
      }

      return collected;
    }, 21600);

    res.json(items);
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/trending failed');
    res.status(500).json({ error: 'Failed to fetch trending videos' });
  }
});

/**
 * GET /api/videos/search
 * Search YouTube for captioned videos matching a query,
 * filtered to the target language's region.
 * Cached in Redis for 1 hour.
 */
router.get('/api/videos/search', authMiddleware, validate({ query: videoSearchQuery }), async (req, res) => {
  try {
    const query = req.query.q.trim();

    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const trendingRegion = LANG_TO_REGION[lang] || 'US';
    const userRegion = (req.query.userRegion || trendingRegion).toString().toUpperCase();

    const normalizedQuery = query.toLowerCase().replace(/\s+/g, ' ');
    const cacheKey = `search:${lang}:${userRegion}:${normalizedQuery}`;

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      req.log.error('GET /api/videos/search: YOUTUBE_API_KEY not set');
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const { data: items } = await cachedFetch(cacheKey, async () => {
      // Step 1: search.list to get video IDs (100 quota units)
      const searchParams = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        videoCaption: 'closedCaption',
        regionCode: trendingRegion,
        relevanceLanguage: lang,
        maxResults: '25',
        q: query,
        key: apiKey,
      });

      const searchRes = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
      if (!searchRes.ok) {
        const body = await searchRes.text();
        req.log.error('YouTube search API error: %d %s', searchRes.status, body);
        throw new Error('Failed to search YouTube');
      }

      const searchData = await searchRes.json();
      const videoIds = (searchData.items || [])
        .map((item) => item.id.videoId)
        .filter(Boolean);

      if (videoIds.length === 0) {
        return [];
      }

      // Step 2: videos.list for full details (1 quota unit)
      const detailUrl =
        `https://www.googleapis.com/youtube/v3/videos` +
        `?part=snippet,contentDetails&id=${videoIds.join(',')}` +
        `&key=${apiKey}`;

      const detailRes = await fetch(detailUrl);
      if (!detailRes.ok) {
        const body = await detailRes.text();
        req.log.error('YouTube video details API error: %d %s', detailRes.status, body);
        throw new Error('Failed to fetch video details from YouTube');
      }

      const detailData = await detailRes.json();
      return filterAndMapTrendingItems(detailData.items, userRegion);
    }, 3600);

    res.json(items);
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/search failed');
    res.status(500).json({ error: 'Failed to search videos' });
  }
});

/**
 * GET /api/videos/channels
 * Return curated channel list with 3 thumbnail URLs per channel.
 * Cached in Redis for 12 hours.
 */
router.get('/api/videos/channels', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const channels = CHANNELS_BY_LANG[lang];
    if (!channels) return res.json([]);

    const cacheKey = `channels:${lang}`;

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      req.log.error('GET /api/videos/channels: YOUTUBE_API_KEY not set');
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const { data: results } = await cachedFetch(cacheKey, async () => {
      return await Promise.all(
        channels.map(async (ch) => {
          try {
            const plUrl =
              `https://www.googleapis.com/youtube/v3/playlistItems` +
              `?part=contentDetails&playlistId=${ch.uploadsPlaylist}` +
              `&maxResults=5&key=${apiKey}`;
            const plRes = await fetch(plUrl);
            if (!plRes.ok) return { name: ch.name, handle: ch.handle, channelId: ch.channelId, thumbnails: [] };

            const plData = await plRes.json();
            const videoIds = (plData.items || []).map((item) => item.contentDetails.videoId).filter(Boolean);
            if (videoIds.length === 0) return { name: ch.name, handle: ch.handle, channelId: ch.channelId, thumbnails: [] };

            const detailUrl =
              `https://www.googleapis.com/youtube/v3/videos` +
              `?part=snippet&id=${videoIds.join(',')}&key=${apiKey}`;
            const detailRes = await fetch(detailUrl);
            if (!detailRes.ok) return { name: ch.name, handle: ch.handle, channelId: ch.channelId, thumbnails: [] };

            const detailData = await detailRes.json();
            const thumbnails = (detailData.items || [])
              .slice(0, 3)
              .map((item) => item.snippet.thumbnails?.medium?.url || `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`);

            return { name: ch.name, handle: ch.handle, channelId: ch.channelId, thumbnails };
          } catch (err) {
            req.log.error({ err }, 'Failed to fetch thumbnails for channel %s', ch.handle);
            return { name: ch.name, handle: ch.handle, channelId: ch.channelId, thumbnails: [] };
          }
        }),
      );
    }, 43200);

    res.json(results);
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/channels failed');
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

/**
 * GET /api/videos/channel/:handle
 * Return videos for a single curated channel.
 * Cached in Redis for 6 hours.
 */
router.get('/api/videos/channel/:handle', authMiddleware, async (req, res) => {
  try {
    const { handle } = req.params;
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const trendingRegion = LANG_TO_REGION[lang] || 'US';
    const userRegion = (req.query.userRegion || trendingRegion).toString().toUpperCase();

    // Find channel in our curated list
    let channel = null;
    for (const langChannels of Object.values(CHANNELS_BY_LANG)) {
      channel = langChannels.find((ch) => ch.handle === handle);
      if (channel) break;
    }
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const cacheKey = `channel3:${handle}:${userRegion}`;

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      req.log.error('GET /api/videos/channel/:handle: YOUTUBE_API_KEY not set');
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const { data: result } = await cachedFetch(cacheKey, async () => {
      // Fetch recent uploads
      const plUrl =
        `https://www.googleapis.com/youtube/v3/playlistItems` +
        `?part=contentDetails&playlistId=${channel.uploadsPlaylist}` +
        `&maxResults=50&key=${apiKey}`;
      const plRes = await fetch(plUrl);
      if (!plRes.ok) {
        const body = await plRes.text();
        req.log.error('YouTube playlist API error: %d %s', plRes.status, body);
        throw new Error('Failed to fetch channel videos from YouTube');
      }

      const plData = await plRes.json();
      const videoIds = (plData.items || []).map((item) => item.contentDetails.videoId).filter(Boolean);

      if (videoIds.length === 0) {
        return { channel: { name: channel.name, handle: channel.handle }, videos: [] };
      }

      const detailUrl =
        `https://www.googleapis.com/youtube/v3/videos` +
        `?part=snippet,contentDetails&id=${videoIds.join(',')}` +
        `&key=${apiKey}`;
      const detailRes = await fetch(detailUrl);
      if (!detailRes.ok) {
        const body = await detailRes.text();
        req.log.error('YouTube video details API error: %d %s', detailRes.status, body);
        throw new Error('Failed to fetch video details from YouTube');
      }

      const detailData = await detailRes.json();
      const videos = filterAndMapTrendingItems(detailData.items, userRegion, { skipCaptionFilter: true });
      videos.sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));

      return { channel: { name: channel.name, handle: channel.handle }, videos };
    }, 21600);

    res.json(result);
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/channel/:handle failed');
    res.status(500).json({ error: 'Failed to fetch channel videos' });
  }
});

/**
 * GET /api/videos/lessons
 * Return lesson summaries with thumbnail previews and video counts.
 * Cached in Redis for 12 hours.
 */
router.get('/api/videos/lessons', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const lessons = LESSONS_BY_LANG[lang];
    if (!lessons) return res.json([]);

    // PT: serve directly from static catalog (no YouTube API needed)
    const catalogCheck = getCatalogVideos(lang, lessons[0]?.id);
    if (catalogCheck !== null) {
      const results = lessons.map((lesson) => {
        const videos = getCatalogVideos(lang, lesson.id) || [];
        return {
          id: lesson.id,
          title: lesson.title,
          thumbnails: videos.slice(0, 3).map((v) => v.thumbnail),
          videoCount: videos.length,
        };
      });
      return res.json(results);
    }

    // Other languages: keyword-match against YouTube API
    const trendingRegion = LANG_TO_REGION[lang] || 'US';
    const userRegion = (req.query.userRegion || trendingRegion).toString().toUpperCase();
    const cacheKey = `lessons2:${lang}:${userRegion}`;

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      req.log.error('GET /api/videos/lessons: YOUTUBE_API_KEY not set');
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const { data: results } = await cachedFetch(cacheKey, async () => {
      const allVideos = await fetchAllChannelVideos(lang, apiKey, userRegion);

      return lessons.map((lesson) => {
        const matched = allVideos.filter((v) => videoMatchesLesson(v.title, lesson));
        return {
          id: lesson.id,
          title: lesson.title,
          thumbnails: matched.slice(0, 3).map((v) => v.thumbnail),
          videoCount: matched.length,
        };
      });
    }, 43200);

    res.json(results);
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/lessons failed');
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
});

/**
 * GET /api/videos/lesson/:id
 * Return lesson detail with matching videos.
 * Cached in Redis for 6 hours.
 */
router.get('/api/videos/lesson/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const lessons = LESSONS_BY_LANG[lang];
    if (!lessons) return res.status(404).json({ error: 'No lessons for this language' });

    const lesson = lessons.find((l) => l.id === id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    // PT: serve directly from static catalog (no YouTube API needed)
    const catalogVideos = getCatalogVideos(lang, id);
    if (catalogVideos !== null) {
      // Sort human-captioned first
      const sorted = [...catalogVideos].sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));
      return res.json({
        lesson: { id: lesson.id, title: lesson.title },
        videos: sorted,
      });
    }

    // Other languages: keyword-match against YouTube API
    const trendingRegion = LANG_TO_REGION[lang] || 'US';
    const userRegion = (req.query.userRegion || trendingRegion).toString().toUpperCase();
    const cacheKey = `lesson2:${id}:${lang}:${userRegion}`;

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      req.log.error('GET /api/videos/lesson/:id: YOUTUBE_API_KEY not set');
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const { data: result } = await cachedFetch(cacheKey, async () => {
      const allVideos = await fetchAllChannelVideos(lang, apiKey, userRegion);
      const matched = allVideos.filter((v) => videoMatchesLesson(v.title, lesson));
      // Sort human-captioned first
      matched.sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));

      return {
        lesson: { id: lesson.id, title: lesson.title },
        videos: matched,
      };
    }, 21600);

    res.json(result);
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/lesson/:id failed');
    res.status(500).json({ error: 'Failed to fetch lesson videos' });
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
    req.log.error({ err }, 'GET /api/videos/:id failed');
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
    req.log.error({ err }, 'POST /api/videos/:id/transcript/retry failed');
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
    req.log.error({ err }, 'PUT /api/videos/:id/transcript failed');
    res.status(500).json({ error: 'Failed to upload transcript' });
  }
});

export default router;
