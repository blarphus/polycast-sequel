import { Router } from 'express';
import pool from '../db.js';
import redisClient from '../redis.js';
import { authMiddleware } from '../auth.js';
import { enqueueTranscriptJob, markReady, clearTranscriptDedupe } from '../services/videoTranscriptQueue.js';
import { fetchYouTubeTranscript } from '../services/videoTranscriptFetcher.js';
import { MOVIES_TV_UPLOADS_PLAYLIST, CHANNELS_BY_LANG } from '../data/channels.js';
import { LESSONS_BY_LANG, videoMatchesLesson } from '../data/lessons.js';
import { cachedFetch } from '../lib/redisCache.js';

const router = Router();

const LANG_TO_REGION = {
  en: 'US', es: 'ES', pt: 'BR', fr: 'FR', de: 'DE', ja: 'JP',
};

/**
 * Fetch all channel videos for a language, reusing per-channel Redis cache.
 */
async function fetchAllChannelVideos(lang, apiKey, userRegion) {
  const channels = CHANNELS_BY_LANG[lang];
  if (!channels) return [];

  const allVideos = await Promise.all(
    channels.map(async (ch) => {
      const cacheKey = `channel3:${ch.handle}:${userRegion}`;

      try {
        const { data } = await cachedFetch(cacheKey, async () => {
          const plUrl =
            `https://www.googleapis.com/youtube/v3/playlistItems` +
            `?part=contentDetails&playlistId=${ch.uploadsPlaylist}` +
            `&maxResults=50&key=${apiKey}`;
          const plRes = await fetch(plUrl);
          if (!plRes.ok) return { channel: { name: ch.name, handle: ch.handle }, videos: [] };

          const plData = await plRes.json();
          const videoIds = (plData.items || []).map((item) => item.contentDetails.videoId).filter(Boolean);
          if (videoIds.length === 0) return { channel: { name: ch.name, handle: ch.handle }, videos: [] };

          const detailUrl =
            `https://www.googleapis.com/youtube/v3/videos` +
            `?part=snippet,contentDetails&id=${videoIds.join(',')}` +
            `&key=${apiKey}`;
          const detailRes = await fetch(detailUrl);
          if (!detailRes.ok) return { channel: { name: ch.name, handle: ch.handle }, videos: [] };

          const detailData = await detailRes.json();
          const videos = filterAndMapTrendingItems(detailData.items, userRegion, { skipCaptionFilter: true });
          videos.sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));

          return { channel: { name: ch.name, handle: ch.handle }, videos };
        }, 21600);

        return data.videos || [];
      } catch (err) {
        console.error(`Failed to fetch videos for channel ${ch.handle}:`, err.message);
        return [];
      }
    }),
  );

  return allVideos.flat();
}

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
 * Filter YouTube items to captioned, non-region-restricted,
 * then map to the normalized trending response shape.
 *
 * Age-restriction filtering is handled client-side via the CF Worker's
 * innertube playability check, since YouTube's Data API returns empty
 * contentRating for many age-restricted videos (especially Movies & TV).
 *
 * @param {Array} items - YouTube Data API video items
 * @param {string} userRegion - the user's actual country code for geo-restriction checks
 */
function filterAndMapTrendingItems(items, userRegion, opts = {}) {
  return (items || [])
    .filter((item) => opts.skipCaptionFilter || item.contentDetails.caption === 'true')
    .filter((item) => parseDuration(item.contentDetails.duration) > 60)
    .filter((item) => {
      const rr = item.contentDetails.regionRestriction;
      if (!rr) return true;
      if (rr.allowed) return rr.allowed.includes(userRegion);
      if (rr.blocked) return !rr.blocked.includes(userRegion);
      return true;
    })
    .map((item) => ({
      youtube_id: item.id,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url ||
                 `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`,
      duration_seconds: parseDuration(item.contentDetails.duration),
      published_at: item.snippet.publishedAt,
      has_captions: item.contentDetails.caption === 'true',
    }));
}

/**
 * Fetch free movies & TV from YouTube's dedicated channel (English only).
 * Step 1: playlistItems.list to get video IDs (1 quota unit)
 * Step 2: videos.list for details + caption filtering (1 quota unit)
 */
async function fetchMoviesAndTV(apiKey, userRegion) {
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
    `?part=snippet,contentDetails&id=${videoIds.join(',')}` +
    `&key=${apiKey}`;

  const detailRes = await fetch(detailUrl);
  if (!detailRes.ok) {
    const body = await detailRes.text();
    console.error('YouTube video details API error:', detailRes.status, body);
    throw new Error('Failed to fetch video details from YouTube');
  }

  const detailData = await detailRes.json();
  return filterAndMapTrendingItems(detailData.items, userRegion);
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
    const trendingRegion = LANG_TO_REGION[lang] || 'US';
    // userRegion = the user's actual country (for filtering geo-restricted content)
    const userRegion = (req.query.userRegion || trendingRegion).toString().toUpperCase();
    const isEnglish = lang === 'en';
    const cacheKey = isEnglish ? `trending:en:movies:${userRegion}` : `trending2:${lang}:${userRegion}`;

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error('GET /api/videos/trending: YOUTUBE_API_KEY not set');
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
          console.error('YouTube trending API error:', ytRes.status, body);
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
    console.error('GET /api/videos/trending failed:', err);
    res.status(500).json({ error: 'Failed to fetch trending videos' });
  }
});

/**
 * GET /api/videos/search
 * Search YouTube for captioned videos matching a query,
 * filtered to the target language's region.
 * Cached in Redis for 1 hour.
 */
router.get('/api/videos/search', authMiddleware, async (req, res) => {
  try {
    const query = (req.query.q || '').toString().trim();
    if (!query) return res.status(400).json({ error: 'Query parameter "q" is required' });

    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const trendingRegion = LANG_TO_REGION[lang] || 'US';
    const userRegion = (req.query.userRegion || trendingRegion).toString().toUpperCase();

    const normalizedQuery = query.toLowerCase().replace(/\s+/g, ' ');
    const cacheKey = `search:${lang}:${userRegion}:${normalizedQuery}`;

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error('GET /api/videos/search: YOUTUBE_API_KEY not set');
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
        console.error('YouTube search API error:', searchRes.status, body);
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
        console.error('YouTube video details API error:', detailRes.status, body);
        throw new Error('Failed to fetch video details from YouTube');
      }

      const detailData = await detailRes.json();
      return filterAndMapTrendingItems(detailData.items, userRegion);
    }, 3600);

    res.json(items);
  } catch (err) {
    console.error('GET /api/videos/search failed:', err);
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
      console.error('GET /api/videos/channels: YOUTUBE_API_KEY not set');
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
            console.error(`Failed to fetch thumbnails for channel ${ch.handle}:`, err.message);
            return { name: ch.name, handle: ch.handle, channelId: ch.channelId, thumbnails: [] };
          }
        }),
      );
    }, 43200);

    res.json(results);
  } catch (err) {
    console.error('GET /api/videos/channels failed:', err);
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
      console.error('GET /api/videos/channel/:handle: YOUTUBE_API_KEY not set');
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
        console.error('YouTube playlist API error:', plRes.status, body);
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
        console.error('YouTube video details API error:', detailRes.status, body);
        throw new Error('Failed to fetch video details from YouTube');
      }

      const detailData = await detailRes.json();
      const videos = filterAndMapTrendingItems(detailData.items, userRegion, { skipCaptionFilter: true });
      videos.sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));

      return { channel: { name: channel.name, handle: channel.handle }, videos };
    }, 21600);

    res.json(result);
  } catch (err) {
    console.error('GET /api/videos/channel/:handle failed:', err);
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

    const trendingRegion = LANG_TO_REGION[lang] || 'US';
    const userRegion = (req.query.userRegion || trendingRegion).toString().toUpperCase();
    const cacheKey = `lessons2:${lang}:${userRegion}`;

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error('GET /api/videos/lessons: YOUTUBE_API_KEY not set');
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const { data: results } = await cachedFetch(cacheKey, async () => {
      const allVideos = await fetchAllChannelVideos(lang, apiKey, userRegion);

      return lessons.map((lesson) => {
        const matched = allVideos.filter((v) => videoMatchesLesson(v.title, lesson));
        return {
          id: lesson.id,
          title: lesson.title,
          level: lesson.level,
          thumbnails: matched.slice(0, 3).map((v) => v.thumbnail),
          videoCount: matched.length,
        };
      });
    }, 43200);

    res.json(results);
  } catch (err) {
    console.error('GET /api/videos/lessons failed:', err);
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

    const trendingRegion = LANG_TO_REGION[lang] || 'US';
    const userRegion = (req.query.userRegion || trendingRegion).toString().toUpperCase();
    const cacheKey = `lesson2:${id}:${lang}:${userRegion}`;

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error('GET /api/videos/lesson/:id: YOUTUBE_API_KEY not set');
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const { data: result } = await cachedFetch(cacheKey, async () => {
      const allVideos = await fetchAllChannelVideos(lang, apiKey, userRegion);
      const matched = allVideos.filter((v) => videoMatchesLesson(v.title, lesson));
      // Sort human-captioned first
      matched.sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));

      return {
        lesson: { id: lesson.id, title: lesson.title, level: lesson.level },
        videos: matched,
      };
    }, 21600);

    res.json(result);
  } catch (err) {
    console.error('GET /api/videos/lesson/:id failed:', err);
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
