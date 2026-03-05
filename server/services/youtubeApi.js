// ---------------------------------------------------------------------------
// services/youtubeApi.js -- YouTube Data API helpers
// ---------------------------------------------------------------------------

import { MOVIES_TV_UPLOADS_PLAYLIST, CHANNELS_BY_LANG } from '../data/channels.js';
import { cachedFetch } from '../lib/redisCache.js';
import logger from '../logger.js';

/**
 * Convert ISO 8601 duration (e.g. PT4M13S) to seconds.
 */
export function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (parseInt(m[1] || '0', 10) * 3600) +
         (parseInt(m[2] || '0', 10) * 60) +
         parseInt(m[3] || '0', 10);
}

/**
 * Extract a YouTube video ID from common URL formats.
 */
export function parseYouTubeId(url) {
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
 * Filter YouTube items to captioned, non-region-restricted,
 * then map to the normalized trending response shape.
 *
 * @param {Array} items - YouTube Data API video items
 * @param {string} userRegion - the user's actual country code for geo-restriction checks
 */
export function filterAndMapTrendingItems(items, userRegion, opts = {}) {
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
 * Detect YouTube Shorts by checking oEmbed dimensions (height > width = vertical = Short).
 * Falls back to /shorts/{id} redirect check if oEmbed doesn't differentiate.
 * Returns a Set of video IDs that are Shorts.
 */
export async function detectShorts(videoIds) {
  const shortsSet = new Set();
  const BATCH = 10;

  for (let i = 0; i < videoIds.length; i += BATCH) {
    const batch = videoIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(async (id) => {
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
        const res = await fetch(oembedUrl);
        if (res.ok) {
          const data = await res.json();
          if (data.height && data.width && data.height > data.width) return id;
          return null;
        }
        // oEmbed failed — fall back to /shorts/ redirect check
        const shortsRes = await fetch(`https://www.youtube.com/shorts/${id}`, { redirect: 'manual' });
        if (shortsRes.status === 200) return id;
        return null;
      } catch {
        return null;
      }
    }));

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) shortsSet.add(r.value);
    }
  }

  return shortsSet;
}

/**
 * Filter Shorts out of a video list using oEmbed dimension detection.
 */
export async function removeShorts(videos) {
  if (videos.length === 0) return videos;
  const ids = videos.map((v) => v.youtube_id);
  const shortsSet = await detectShorts(ids);
  if (shortsSet.size === 0) return videos;
  logger.info('Filtered %d Shorts from %d videos', shortsSet.size, videos.length);
  return videos.filter((v) => !shortsSet.has(v.youtube_id));
}

/**
 * Fetch free movies & TV from YouTube's dedicated channel (English only).
 */
export async function fetchMoviesAndTV(apiKey, userRegion) {
  const plUrl =
    `https://www.googleapis.com/youtube/v3/playlistItems` +
    `?part=contentDetails&playlistId=${MOVIES_TV_UPLOADS_PLAYLIST}` +
    `&maxResults=50&key=${apiKey}`;

  const plRes = await fetch(plUrl);
  if (!plRes.ok) {
    const body = await plRes.text();
    logger.error('YouTube Movies & TV playlist API error: %d %s', plRes.status, body);
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
    logger.error('YouTube video details API error: %d %s', detailRes.status, body);
    throw new Error('Failed to fetch video details from YouTube');
  }

  const detailData = await detailRes.json();
  return filterAndMapTrendingItems(detailData.items, userRegion);
}

/**
 * Fetch all channel videos for a language, reusing per-channel Redis cache.
 */
export async function fetchAllChannelVideos(lang, apiKey, userRegion) {
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
          let videos = filterAndMapTrendingItems(detailData.items, userRegion, { skipCaptionFilter: true });
          videos = await removeShorts(videos);
          videos.sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));

          return { channel: { name: ch.name, handle: ch.handle }, videos };
        }, 21600);

        return data.videos || [];
      } catch (err) {
        logger.error({ err }, 'Failed to fetch videos for channel %s', ch.handle);
        return [];
      }
    }),
  );

  return allVideos.flat();
}
