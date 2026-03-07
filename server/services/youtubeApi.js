// ---------------------------------------------------------------------------
// services/youtubeApi.js -- YouTube Data API helpers
// ---------------------------------------------------------------------------

import { MOVIES_TV_UPLOADS_PLAYLIST, CHANNELS_BY_LANG } from '../data/channels.js';
import { cachedFetch } from '../lib/redisCache.js';
import logger from '../logger.js';

function fetchError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function fetchYouTubeJson(url, friendlyMessage, logPrefix) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    logger.error('%s: %d %s', logPrefix, res.status, body);
    throw fetchError(friendlyMessage, 502);
  }
  return res.json();
}

export function getYouTubeApiKey() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw fetchError('YouTube API key not configured', 500);
  }
  return apiKey;
}

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

export async function fetchYouTubeVideoMetadata(youtubeId, apiKey) {
  const metaUrl =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,contentDetails&id=${youtubeId}&key=${apiKey}`;
  const data = await fetchYouTubeJson(
    metaUrl,
    'Failed to fetch video metadata from YouTube',
    'YouTube Data API error',
  );
  return data.items?.[0] || null;
}

export async function fetchYouTubePlaylistVideoIds(playlistId, apiKey, maxResults = 50) {
  const plUrl =
    `https://www.googleapis.com/youtube/v3/playlistItems` +
    `?part=contentDetails&playlistId=${playlistId}` +
    `&maxResults=${maxResults}&key=${apiKey}`;
  const data = await fetchYouTubeJson(
    plUrl,
    'Failed to fetch playlist from YouTube',
    'YouTube playlist API error',
  );
  return (data.items || []).map((item) => item.contentDetails.videoId).filter(Boolean);
}

export async function fetchYouTubeVideoDetails(videoIds, apiKey, part = 'snippet,contentDetails') {
  if (!videoIds.length) return [];
  const detailUrl =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=${part}&id=${videoIds.join(',')}` +
    `&key=${apiKey}`;
  const data = await fetchYouTubeJson(
    detailUrl,
    'Failed to fetch video details from YouTube',
    'YouTube video details API error',
  );
  return data.items || [];
}

export async function searchCaptionedVideoIds(query, lang, regionCode, apiKey, maxResults = 25) {
  const searchParams = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoCaption: 'closedCaption',
    regionCode,
    relevanceLanguage: lang,
    maxResults: String(maxResults),
    q: query,
    key: apiKey,
  });
  const data = await fetchYouTubeJson(
    `https://www.googleapis.com/youtube/v3/search?${searchParams}`,
    'Failed to search YouTube',
    'YouTube search API error',
  );
  return (data.items || []).map((item) => item.id.videoId).filter(Boolean);
}

export async function fetchTrendingPage(regionCode, apiKey, pageToken) {
  const ytUrl =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,contentDetails&chart=mostPopular` +
    `&regionCode=${regionCode}&maxResults=50&key=${apiKey}` +
    (pageToken ? `&pageToken=${pageToken}` : '');
  return fetchYouTubeJson(
    ytUrl,
    'Failed to fetch trending videos from YouTube',
    'YouTube trending API error',
  );
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
 * Fetch free movies & TV from YouTube's dedicated channel (English only).
 */
export async function fetchMoviesAndTV(apiKey, userRegion) {
  const videoIds = await fetchYouTubePlaylistVideoIds(MOVIES_TV_UPLOADS_PLAYLIST, apiKey);

  if (videoIds.length === 0) {
    throw new Error('Movies & TV playlist returned no videos');
  }

  const items = await fetchYouTubeVideoDetails(videoIds, apiKey);
  return filterAndMapTrendingItems(items, userRegion);
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
      const { data } = await cachedFetch(cacheKey, async () => {
        const videoIds = await fetchYouTubePlaylistVideoIds(ch.uploadsPlaylist, apiKey);
        if (videoIds.length === 0) return { channel: { name: ch.name, handle: ch.handle }, videos: [] };

        const items = await fetchYouTubeVideoDetails(videoIds, apiKey);
        const videos = filterAndMapTrendingItems(items, userRegion, { skipCaptionFilter: true });
        videos.sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));

        return { channel: { name: ch.name, handle: ch.handle }, videos };
      }, 21600);

      return data.videos || [];
    }),
  );

  return allVideos.flat();
}
