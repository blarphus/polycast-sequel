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

export async function fetchYouTubePlaylistVideoPage(playlistId, apiKey, maxResults = 50, pageToken) {
  const params = new URLSearchParams({
    part: 'contentDetails',
    playlistId,
    maxResults: String(maxResults),
    key: apiKey,
  });
  if (pageToken) params.set('pageToken', pageToken);

  const plUrl =
    `https://www.googleapis.com/youtube/v3/playlistItems` +
    `?${params}`;
  const data = await fetchYouTubeJson(
    plUrl,
    'Failed to fetch playlist from YouTube',
    'YouTube playlist API error',
  );
  return {
    videoIds: (data.items || []).map((item) => item.contentDetails.videoId).filter(Boolean),
    nextPageToken: data.nextPageToken || null,
  };
}

export async function fetchYouTubePlaylistVideoIds(playlistId, apiKey, maxResults = 50) {
  const page = await fetchYouTubePlaylistVideoPage(playlistId, apiKey, maxResults);
  return page.videoIds;
}

export async function fetchYouTubeChannel(channelRef, apiKey) {
  const normalized = String(channelRef || '').trim().replace(/^@+/, '');
  if (!normalized) return null;

  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    key: apiKey,
  });
  if (normalized.startsWith('UC')) {
    params.set('id', normalized);
  } else {
    params.set('forHandle', normalized);
  }

  const data = await fetchYouTubeJson(
    `https://www.googleapis.com/youtube/v3/channels?${params}`,
    'Failed to fetch channel from YouTube',
    'YouTube channel API error',
  );
  const item = data.items?.[0];
  if (!item) return null;

  return {
    name: item.snippet.title,
    handle: item.id,
    channelId: item.id,
    uploadsPlaylist: item.contentDetails?.relatedPlaylists?.uploads,
    thumbnails: [item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url].filter(Boolean),
  };
}

export async function fetchYouTubeVideoDetails(videoIds, apiKey, part = 'snippet,contentDetails') {
  if (!videoIds.length) return [];
  // videos.list accepts at most 50 ids per request — chunk so callers that
  // aggregate across channels (e.g. the highlights carousel) don't 400.
  const CHUNK = 50;
  const items = [];
  for (let i = 0; i < videoIds.length; i += CHUNK) {
    const batch = videoIds.slice(i, i + CHUNK);
    const detailUrl =
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=${part}&id=${batch.join(',')}` +
      `&key=${apiKey}`;
    const data = await fetchYouTubeJson(
      detailUrl,
      'Failed to fetch video details from YouTube',
      'YouTube video details API error',
    );
    if (data.items) items.push(...data.items);
  }
  return items;
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

export async function searchYouTubeChannels(query, lang, regionCode, apiKey, maxResults = 6) {
  const searchParams = new URLSearchParams({
    part: 'snippet',
    type: 'channel',
    regionCode,
    relevanceLanguage: lang,
    maxResults: String(maxResults),
    q: query,
    key: apiKey,
  });
  const data = await fetchYouTubeJson(
    `https://www.googleapis.com/youtube/v3/search?${searchParams}`,
    'Failed to search YouTube channels',
    'YouTube channel search API error',
  );

  return (data.items || [])
    .map((item) => {
      const channelId = item.id?.channelId || item.snippet?.channelId;
      if (!channelId) return null;
      return {
        name: item.snippet?.title || 'YouTube channel',
        handle: channelId,
        channel_id: channelId,
        thumbnails: [
          item.snippet?.thumbnails?.medium?.url ||
            item.snippet?.thumbnails?.high?.url ||
            item.snippet?.thumbnails?.default?.url,
        ].filter(Boolean),
      };
    })
    .filter(Boolean);
}

export async function searchYouTubeVideoAndChannelResults(query, lang, regionCode, apiKey, maxResults = 30) {
  const searchParams = new URLSearchParams({
    part: 'snippet',
    type: 'video,channel',
    regionCode,
    relevanceLanguage: lang,
    maxResults: String(maxResults),
    q: query,
    key: apiKey,
  });
  const data = await fetchYouTubeJson(
    `https://www.googleapis.com/youtube/v3/search?${searchParams}`,
    'Failed to search YouTube videos and channels',
    'YouTube mixed search API error',
  );

  return (data.items || [])
    .map((item, index) => {
      if (item.id?.kind === 'youtube#video' && item.id.videoId) {
        return {
          type: 'video',
          video_id: item.id.videoId,
          search_rank: index,
        };
      }

      const channelId = item.id?.channelId || item.snippet?.channelId;
      if (item.id?.kind === 'youtube#channel' && channelId) {
        return {
          type: 'channel',
          name: item.snippet?.title || 'YouTube channel',
          handle: channelId,
          channel_id: channelId,
          thumbnails: [
            item.snippet?.thumbnails?.medium?.url ||
              item.snippet?.thumbnails?.high?.url ||
              item.snippet?.thumbnails?.default?.url,
          ].filter(Boolean),
          search_rank: index,
        };
      }

      return null;
    })
    .filter(Boolean);
}

export async function fetchTrendingPage(regionCode, apiKey, pageToken) {
  const ytUrl =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,contentDetails,statistics&chart=mostPopular` +
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
  const wantLang = opts.lang ? String(opts.lang).toLowerCase().split('-')[0] : null;
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
    // Keep only target-language videos: region "most popular" otherwise leaks
    // other-language hits (e.g. English music in a Spanish feed). Drop items
    // YouTube tags as a different language; keep untagged ones (no reliable
    // signal, and they're usually in-language for a region feed).
    .filter((item) => {
      if (!wantLang) return true;
      const vlang = (item.snippet.defaultAudioLanguage || item.snippet.defaultLanguage || '')
        .toLowerCase().split('-')[0];
      return !vlang || vlang === wantLang;
    })
    .map((item) => ({
      youtube_id: item.id,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url ||
                 `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`,
      duration_seconds: parseDuration(item.contentDetails.duration),
      published_at: item.snippet.publishedAt,
      // Present only when the caller requested the `statistics` part (channel
      // detail does, for the "most popular" sort); null otherwise.
      view_count: item.statistics?.viewCount != null ? Number(item.statistics.viewCount) : null,
      has_captions: item.contentDetails.caption === 'true',
    }));
}

/**
 * Map short-duration YouTube videos into the same normalized shape used by the
 * app's video feeds. YouTube Data API does not expose a reliable "is Short"
 * field or complete caption availability, so the app still verifies orientation
 * and timed captions before showing a candidate.
 */
export function filterAndMapShortCandidateItems(items, userRegion, opts = {}) {
  const maxDurationSeconds = opts.maxDurationSeconds || 240;
  const minDurationSeconds = opts.minDurationSeconds || 5;
  return (items || [])
    .filter((item) => {
      const duration = parseDuration(item.contentDetails?.duration || '');
      return duration >= minDurationSeconds && duration <= maxDurationSeconds;
    })
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
      thumbnail: item.snippet.thumbnails?.high?.url ||
                 item.snippet.thumbnails?.medium?.url ||
                 `https://img.youtube.com/vi/${item.id}/hqdefault.jpg`,
      duration_seconds: parseDuration(item.contentDetails.duration),
      published_at: item.snippet.publishedAt,
      view_count: item.statistics?.viewCount != null ? Number(item.statistics.viewCount) : null,
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

  const items = await fetchYouTubeVideoDetails(videoIds, apiKey, 'snippet,contentDetails,statistics');
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
      const cacheKey = `channel5:${ch.handle}:${userRegion}`;
      const { data } = await cachedFetch(cacheKey, async () => {
        const videoIds = await fetchYouTubePlaylistVideoIds(ch.uploadsPlaylist, apiKey);
        if (videoIds.length === 0) return { channel: { name: ch.name, handle: ch.handle }, videos: [] };

        const items = await fetchYouTubeVideoDetails(videoIds, apiKey, 'snippet,contentDetails,statistics');
        const videos = filterAndMapTrendingItems(items, userRegion, { skipCaptionFilter: true });
        videos.sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));

        return { channel: { name: ch.name, handle: ch.handle }, videos };
      }, 21600);

      return data.videos || [];
    }),
  );

  return allVideos.flat();
}
