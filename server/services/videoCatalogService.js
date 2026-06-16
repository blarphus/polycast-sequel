import { CHANNELS_BY_LANG } from '../data/channels.js';
import { LESSONS_BY_LANG, videoMatchesLesson, getCatalogVideos } from '../data/lessons.js';
import { cachedFetch } from '../lib/redisCache.js';
import pool from '../db.js';
import {
  filterAndMapTrendingItems,
  fetchMoviesAndTV,
  fetchAllChannelVideos,
  fetchYouTubeChannel,
  fetchTrendingPage,
  fetchYouTubePlaylistVideoIds,
  fetchYouTubeVideoDetails,
  getYouTubeApiKey,
  searchCaptionedVideoIds,
} from './youtubeApi.js';

const LANG_TO_REGION = {
  en: 'US',
  es: 'ES',
  pt: 'BR',
  fr: 'FR',
  de: 'DE',
  ja: 'JP',
};

function resolveUserRegion(lang, userRegion) {
  const trendingRegion = LANG_TO_REGION[lang] || 'US';
  return {
    trendingRegion,
    userRegion: (userRegion || trendingRegion).toUpperCase(),
  };
}

function findChannelByHandle(handle) {
  const normalizedHandle = String(handle || '').trim().replace(/^@+/, '').toLowerCase();
  for (const langChannels of Object.values(CHANNELS_BY_LANG)) {
    const channel = langChannels.find((ch) => ch.handle.toLowerCase() === normalizedHandle);
    if (channel) return channel;
  }
  return null;
}

function normalizeChannelRef(handle) {
  return String(handle || '').trim().replace(/^@+/, '');
}

async function resolveChannel(handle, apiKey) {
  const curated = findChannelByHandle(handle);
  if (curated) return curated;

  const channel = await fetchYouTubeChannel(handle, apiKey);
  if (!channel?.uploadsPlaylist) {
    const err = new Error('Channel not found');
    err.status = 404;
    throw err;
  }
  return channel;
}

function getChannelsForLanguage(lang) {
  const channels = CHANNELS_BY_LANG[lang];
  if (!channels) {
    const err = new Error('No channels for this language');
    err.status = 404;
    throw err;
  }
  return channels;
}

async function ensureDefaultSubscriptions(userId, lang) {
  const channels = getChannelsForLanguage(lang);
  const { rows } = await pool.query(
    'SELECT 1 FROM channel_subscriptions WHERE user_id = $1 AND lang = $2 LIMIT 1',
    [userId, lang],
  );
  if (rows.length > 0) return;

  await pool.query(
    `INSERT INTO channel_subscriptions (user_id, lang, handle)
     SELECT $1, $2, unnest($3::text[])
     ON CONFLICT DO NOTHING`,
    [userId, lang, channels.map((channel) => channel.handle)],
  );
}

async function getSubscribedHandles(userId, lang) {
  await ensureDefaultSubscriptions(userId, lang);
  const { rows } = await pool.query(
    'SELECT handle FROM channel_subscriptions WHERE user_id = $1 AND lang = $2',
    [userId, lang],
  );
  return new Set(rows.map((row) => row.handle));
}

export async function getTrendingVideosForLanguage(lang = 'en', userRegion) {
  const { trendingRegion, userRegion: resolvedUserRegion } = resolveUserRegion(lang, userRegion);
  const isEnglish = lang === 'en';
  const cacheKey = isEnglish
    ? `trending3:en:movies:${resolvedUserRegion}`
    : `trending3:${lang}:${resolvedUserRegion}`;
  const apiKey = getYouTubeApiKey();

  const { data } = await cachedFetch(cacheKey, async () => {
    if (isEnglish) {
      return fetchMoviesAndTV(apiKey, resolvedUserRegion);
    }

    const TARGET = 20;
    const MAX_PAGES = 4;
    const collected = [];
    let pageToken;

    for (let page = 0; page < MAX_PAGES && collected.length < TARGET; page++) {
      const ytData = await fetchTrendingPage(trendingRegion, apiKey, pageToken);
      collected.push(...filterAndMapTrendingItems(ytData.items, resolvedUserRegion));
      pageToken = ytData.nextPageToken;
      if (!pageToken) break;
    }

    return collected;
  }, 21600);

  return data;
}

export async function searchVideosForLanguage(query, lang = 'en', userRegion) {
  const { trendingRegion, userRegion: resolvedUserRegion } = resolveUserRegion(lang, userRegion);
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, ' ');
  const cacheKey = `search2:${lang}:${resolvedUserRegion}:${normalizedQuery}`;
  const apiKey = getYouTubeApiKey();

  const { data } = await cachedFetch(cacheKey, async () => {
    const videoIds = await searchCaptionedVideoIds(query, lang, trendingRegion, apiKey);
    if (videoIds.length === 0) return [];
    const items = await fetchYouTubeVideoDetails(videoIds, apiKey, 'snippet,contentDetails,statistics');
    return filterAndMapTrendingItems(items, resolvedUserRegion);
  }, 3600);

  return data;
}

export async function getChannelSummaries(lang = 'en') {
  const channels = getChannelsForLanguage(lang);

  // channels3 — summaries now use channel profile images instead of recent
  // upload thumbnails.
  const cacheKey = `channels3:${lang}`;
  const apiKey = getYouTubeApiKey();

  const { data } = await cachedFetch(cacheKey, async () => {
    return Promise.all(
      channels.map(async (ch) => {
        const channel = await fetchYouTubeChannel(ch.channelId, apiKey).catch(() => null);
        return {
          name: channel?.name || ch.name,
          handle: ch.handle,
          channelId: ch.channelId,
          thumbnails: channel?.thumbnails || [],
        };
      }),
    );
  }, 43200);

  return data;
}

export async function getChannelSummariesForUser(userId, lang = 'en') {
  const [channels, subscribedHandles] = await Promise.all([
    getChannelSummaries(lang),
    getSubscribedHandles(userId, lang),
  ]);
  return channels.map((channel) => ({
    ...channel,
    subscribed: subscribedHandles.has(channel.handle),
  }));
}

export async function subscribeToChannel(userId, lang = 'en', handle) {
  const apiKey = getYouTubeApiKey();
  const channel = await resolveChannel(handle, apiKey);
  await ensureDefaultSubscriptions(userId, lang);
  await pool.query(
    `INSERT INTO channel_subscriptions (user_id, lang, handle)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userId, lang, channel.handle],
  );
  return { name: channel.name, handle: channel.handle, channelId: channel.channelId, thumbnails: channel.thumbnails || [], subscribed: true };
}

export async function unsubscribeFromChannel(userId, lang = 'en', handle) {
  const normalizedHandle = normalizeChannelRef(handle);
  await ensureDefaultSubscriptions(userId, lang);
  await pool.query(
    'DELETE FROM channel_subscriptions WHERE user_id = $1 AND lang = $2 AND handle = $3',
    [userId, lang, normalizedHandle],
  );
  return { handle: normalizedHandle, subscribed: false };
}

export async function getChannelSubscription(userId, lang = 'en', handle) {
  const apiKey = getYouTubeApiKey();
  const channel = await resolveChannel(handle, apiKey);
  const subscribedHandles = await getSubscribedHandles(userId, lang);
  return {
    name: channel.name,
    handle: channel.handle,
    channelId: channel.channelId,
    thumbnails: channel.thumbnails || [],
    subscribed: subscribedHandles.has(channel.handle),
  };
}

/**
 * A carousel of "popular new videos" across the curated channels for a
 * language: the latest few uploads from each channel, ranked by view count.
 * Used above the channel list in the Videos tab.
 */
export async function getChannelHighlights(lang = 'en', userRegion) {
  const channels = getChannelsForLanguage(lang);

  const { userRegion: resolvedUserRegion } = resolveUserRegion(lang, userRegion);
  const cacheKey = `highlights:${lang}:${resolvedUserRegion}`;
  const apiKey = getYouTubeApiKey();

  const { data } = await cachedFetch(cacheKey, async () => {
    // Latest 5 uploads per channel — "new" — then rank the pool by views.
    const idLists = await Promise.all(
      channels.map((ch) => fetchYouTubePlaylistVideoIds(ch.uploadsPlaylist, apiKey, 5)),
    );
    const videoIds = idLists.flat();
    if (videoIds.length === 0) return [];

    const items = await fetchYouTubeVideoDetails(videoIds, apiKey, 'snippet,contentDetails,statistics');
    const videos = filterAndMapTrendingItems(items, resolvedUserRegion, { skipCaptionFilter: true });
    videos.sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0));
    return videos.slice(0, 15);
  }, 21600);

  return data;
}

export async function getSubscriptionFeed(userId, lang = 'en', userRegion) {
  const subscribedHandles = await getSubscribedHandles(userId, lang);
  const apiKey = getYouTubeApiKey();
  const subscribedChannels = (
    await Promise.all([...subscribedHandles].map((handle) => resolveChannel(handle, apiKey).catch(() => null)))
  ).filter(Boolean);
  if (subscribedChannels.length === 0) return [];

  const { userRegion: resolvedUserRegion } = resolveUserRegion(lang, userRegion);
  const cacheKey = `subscriptions:${lang}:${resolvedUserRegion}:${[...subscribedHandles].sort().join(',')}`;

  const { data } = await cachedFetch(cacheKey, async () => {
    const idLists = await Promise.all(
      subscribedChannels.map((channel) => fetchYouTubePlaylistVideoIds(channel.uploadsPlaylist, apiKey, 8)),
    );
    const videoIds = idLists.flat();
    if (videoIds.length === 0) return [];

    const items = await fetchYouTubeVideoDetails(videoIds, apiKey, 'snippet,contentDetails,statistics');
    const videos = filterAndMapTrendingItems(items, resolvedUserRegion, { skipCaptionFilter: true });
    videos.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
    return videos.slice(0, 40);
  }, 1800);

  return data;
}

export async function getChannelDetail(handle, lang = 'en', userRegion) {
  const { userRegion: resolvedUserRegion } = resolveUserRegion(lang, userRegion);
  // cache key bumped to channel4 — response now carries view_count per video.
  const apiKey = getYouTubeApiKey();
  const channel = await resolveChannel(handle, apiKey);
  const cacheKey = `channel5:${channel.handle}:${resolvedUserRegion}`;

  const { data } = await cachedFetch(cacheKey, async () => {
    const videoIds = await fetchYouTubePlaylistVideoIds(channel.uploadsPlaylist, apiKey);
    if (videoIds.length === 0) {
      return { channel: { name: channel.name, handle: channel.handle, channelId: channel.channelId }, videos: [] };
    }
    // Include statistics so the client can sort by view count ("most popular").
    const items = await fetchYouTubeVideoDetails(videoIds, apiKey, 'snippet,contentDetails,statistics');
    const videos = filterAndMapTrendingItems(items, resolvedUserRegion, { skipCaptionFilter: true });
    videos.sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));
    return { channel: { name: channel.name, handle: channel.handle, channelId: channel.channelId }, videos };
  }, 21600);

  return data;
}

export async function getLessonSummaries(lang = 'en', userRegion) {
  const lessons = LESSONS_BY_LANG[lang];
  if (!lessons) return [];

  const catalogCheck = getCatalogVideos(lang, lessons[0]?.id);
  if (catalogCheck !== null) {
    return lessons.map((lesson) => {
      const videos = getCatalogVideos(lang, lesson.id) || [];
      return {
        id: lesson.id,
        title: lesson.title,
        thumbnails: videos.slice(0, 3).map((v) => v.thumbnail),
        videoCount: videos.length,
      };
    });
  }

  const { userRegion: resolvedUserRegion } = resolveUserRegion(lang, userRegion);
  const cacheKey = `lessons2:${lang}:${resolvedUserRegion}`;
  const apiKey = getYouTubeApiKey();

  const { data } = await cachedFetch(cacheKey, async () => {
    const allVideos = await fetchAllChannelVideos(lang, apiKey, resolvedUserRegion);
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

  return data;
}

export async function getLessonDetail(id, lang = 'en', userRegion) {
  const lessons = LESSONS_BY_LANG[lang];
  if (!lessons) {
    const err = new Error('No lessons for this language');
    err.status = 404;
    throw err;
  }

  const lesson = lessons.find((l) => l.id === id);
  if (!lesson) {
    const err = new Error('Lesson not found');
    err.status = 404;
    throw err;
  }

  const catalogVideos = getCatalogVideos(lang, id);
  if (catalogVideos !== null) {
    const videos = [...catalogVideos].sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));
    return { lesson: { id: lesson.id, title: lesson.title }, videos };
  }

  const { userRegion: resolvedUserRegion } = resolveUserRegion(lang, userRegion);
  const cacheKey = `lesson2:${id}:${lang}:${resolvedUserRegion}`;
  const apiKey = getYouTubeApiKey();

  const { data } = await cachedFetch(cacheKey, async () => {
    const allVideos = await fetchAllChannelVideos(lang, apiKey, resolvedUserRegion);
    const matched = allVideos.filter((v) => videoMatchesLesson(v.title, lesson));
    matched.sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));
    return {
      lesson: { id: lesson.id, title: lesson.title },
      videos: matched,
    };
  }, 21600);

  return data;
}
