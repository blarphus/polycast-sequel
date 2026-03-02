import { Router } from 'express';
import pool from '../db.js';
import redisClient from '../redis.js';
import { authMiddleware } from '../auth.js';
import { enqueueTranscriptJob } from '../services/videoTranscriptQueue.js';
import { fetchYouTubeTranscript } from '../services/videoTranscriptFetcher.js';
import { Innertube } from 'youtubei.js';

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
    `?part=snippet,contentDetails&id=${videoIds.join(',')}` +
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
        `?part=snippet,contentDetails&chart=mostPopular` +
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
 * GET /api/videos/debug-transcript/:youtubeId
 * Diagnostic endpoint — tests each method individually with detailed results.
 */
router.get('/api/videos/debug-transcript/:youtubeId', authMiddleware, async (req, res) => {
  const { youtubeId } = req.params;
  const lang = req.query.lang || 'en';
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const API_KEY = process.env.INNERTUBE_API_KEY || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  const results = { nodeVersion: process.version };

  // Test 1: YouTube homepage visit
  let visitorData = '';
  let sessionCookies = '';
  try {
    const homeRes = await fetch('https://www.youtube.com/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
    });
    const homeHtml = await homeRes.text();
    const visitorMatch = homeHtml.match(/"VISITOR_DATA":"([^"]+)"/);
    visitorData = visitorMatch?.[1] || '';
    sessionCookies = (homeRes.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    results.homepage = {
      status: homeRes.status,
      htmlLength: homeHtml.length,
      hasVisitorData: Boolean(visitorData),
      cookieLength: sessionCookies.length,
    };
  } catch (err) {
    results.homepage = { error: err.message };
  }

  // Test 2: Bare IOS Innertube API (no session)
  try {
    const t = Date.now();
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({
        context: { client: { clientName: 'IOS', clientVersion: '20.10.4' } },
        videoId: youtubeId,
      }),
    });
    const body = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch {}
    const tracks = parsed?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const playability = parsed?.playabilityStatus;
    results.bareIOS = {
      status: r.status,
      elapsed: Date.now() - t,
      bodyLength: body.length,
      playability: playability ? `${playability.status}: ${playability.reason || 'no reason'}` : 'no playability',
      trackCount: tracks?.length || 0,
      bodyPreview: body.length < 300 ? body : undefined,
    };
  } catch (err) {
    results.bareIOS = { error: err.message };
  }

  // Test 3: Sessioned IOS Innertube API (with homepage session)
  try {
    const t = Date.now();
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        ...(sessionCookies ? { 'Cookie': sessionCookies } : {}),
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'IOS',
            clientVersion: '20.10.4',
            ...(visitorData ? { visitorData } : {}),
          },
        },
        videoId: youtubeId,
      }),
    });
    const body = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch {}
    const tracks = parsed?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const playability = parsed?.playabilityStatus;
    results.sessionedIOS = {
      status: r.status,
      elapsed: Date.now() - t,
      bodyLength: body.length,
      playability: playability ? `${playability.status}: ${playability.reason || 'no reason'}` : 'no playability',
      trackCount: tracks?.length || 0,
    };

    // If tracks found, try timedtext
    if (tracks && tracks.length > 0) {
      const track = tracks.find(tr => tr.languageCode === lang) || tracks[0];
      const ttUrl = track.baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3';
      const ttRes = await fetch(ttUrl, { headers: { 'User-Agent': UA } });
      const ttBody = await ttRes.text();
      results.timedtext = { status: ttRes.status, bodyLength: ttBody.length };
    }
  } catch (err) {
    results.sessionedIOS = { error: err.message };
  }

  // Test 4: Watch page — extract player data and try timedtext with cookies
  try {
    const t = Date.now();
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${youtubeId}`, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html',
        'Accept-Language': `${lang},en;q=0.9`,
      },
    });
    const watchHtml = await watchRes.text();
    const watchCookies = (watchRes.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    const marker = 'var ytInitialPlayerResponse = ';
    const startIdx = watchHtml.indexOf(marker);

    const wpResult = { status: watchRes.status, htmlLength: watchHtml.length, elapsed: Date.now() - t };

    if (startIdx !== -1) {
      let depth = 0, end = -1;
      for (let i = startIdx + marker.length; i < watchHtml.length; i++) {
        if (watchHtml[i] === '{') depth++;
        else if (watchHtml[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      const wpData = JSON.parse(watchHtml.slice(startIdx + marker.length, end));
      const wpTracks = wpData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      const wpPlay = wpData?.playabilityStatus;
      wpResult.playability = wpPlay ? `${wpPlay.status}: ${wpPlay.reason || 'ok'}` : 'none';
      wpResult.trackCount = wpTracks?.length || 0;

      if (wpTracks && wpTracks.length > 0) {
        const track = wpTracks.find(tr => tr.languageCode === lang) || wpTracks[0];
        // Test timedtext with session cookies
        const ttUrl = track.baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3';
        const ttRes = await fetch(ttUrl, {
          headers: { 'User-Agent': UA, 'Cookie': watchCookies },
        });
        const ttBody = await ttRes.text();
        wpResult.timedtext = { status: ttRes.status, bodyLength: ttBody.length };

        // Also try XML format without cookies
        const xmlUrl = track.baseUrl.replace(/&fmt=[^&]*/, '');
        const xmlRes = await fetch(xmlUrl, { headers: { 'User-Agent': UA } });
        const xmlBody = await xmlRes.text();
        wpResult.timedtextXml = { status: xmlRes.status, bodyLength: xmlBody.length, preview: xmlBody.slice(0, 100) };
      }
    } else {
      wpResult.error = 'No ytInitialPlayerResponse found';
    }
    results.watchPage = wpResult;
  } catch (err) {
    results.watchPage = { error: err.message };
  }

  // Test 5: youtubei.js session + manual IOS API
  try {
    const t = Date.now();
    const yt = await Innertube.create();
    const ytVisitorData = yt.session?.context?.client?.visitorData || '';
    const ytApiKey = yt.session?.api_key || API_KEY;
    results.youtubeijsSession = {
      hasVisitorData: Boolean(ytVisitorData),
      elapsed: Date.now() - t,
    };

    const t2 = Date.now();
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${ytApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'IOS',
            clientVersion: '20.10.4',
            visitorData: ytVisitorData,
          },
        },
        videoId: youtubeId,
      }),
    });
    const body = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch {}
    const tracks = parsed?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const playability = parsed?.playabilityStatus;
    results.youtubeijsIOS = {
      status: r.status,
      elapsed: Date.now() - t2,
      playability: playability ? `${playability.status}: ${playability.reason || 'ok'}` : 'none',
      trackCount: tracks?.length || 0,
    };

    if (tracks && tracks.length > 0) {
      const track = tracks.find(tr => tr.languageCode === lang) || tracks[0];
      const ttUrl = track.baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3';
      const ttRes = await fetch(ttUrl, { headers: { 'User-Agent': UA } });
      const ttBody = await ttRes.text();
      results.youtubeijsTimedtext = { status: ttRes.status, bodyLength: ttBody.length };
    }
  } catch (err) {
    results.youtubeijsIOS = { error: err.message };
  }

  res.json(results);
});

export default router;
