import { CHANNELS_BY_LANG } from '../data/channels.js';
import { LESSONS_BY_LANG, videoMatchesLesson, getCatalogVideos } from '../data/lessons.js';
import { cachedFetch } from '../lib/redisCache.js';
import {
  filterAndMapTrendingItems,
  fetchMoviesAndTV,
  fetchAllChannelVideos,
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
  for (const langChannels of Object.values(CHANNELS_BY_LANG)) {
    const channel = langChannels.find((ch) => ch.handle === handle);
    if (channel) return channel;
  }
  return null;
}

export async function getTrendingVideosForLanguage(lang = 'en', userRegion) {
  const { trendingRegion, userRegion: resolvedUserRegion } = resolveUserRegion(lang, userRegion);
  const isEnglish = lang === 'en';
  const cacheKey = isEnglish
    ? `trending:en:movies:${resolvedUserRegion}`
    : `trending2:${lang}:${resolvedUserRegion}`;
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
  const cacheKey = `search:${lang}:${resolvedUserRegion}:${normalizedQuery}`;
  const apiKey = getYouTubeApiKey();

  const { data } = await cachedFetch(cacheKey, async () => {
    const videoIds = await searchCaptionedVideoIds(query, lang, trendingRegion, apiKey);
    if (videoIds.length === 0) return [];
    const items = await fetchYouTubeVideoDetails(videoIds, apiKey);
    return filterAndMapTrendingItems(items, resolvedUserRegion);
  }, 3600);

  return data;
}

export async function getChannelSummaries(lang = 'en') {
  const channels = CHANNELS_BY_LANG[lang];
  if (!channels) {
    const err = new Error('No channels for this language');
    err.status = 404;
    throw err;
  }

  // channels2 — bumped when the curated channel list changes so the new
  // entries appear without waiting for the previous cache to expire.
  const cacheKey = `channels2:${lang}`;
  const apiKey = getYouTubeApiKey();

  const { data } = await cachedFetch(cacheKey, async () => {
    return Promise.all(
      channels.map(async (ch) => {
        const videoIds = await fetchYouTubePlaylistVideoIds(ch.uploadsPlaylist, apiKey, 5);
        if (videoIds.length === 0) {
          return { name: ch.name, handle: ch.handle, channelId: ch.channelId, thumbnails: [] };
        }
        const items = await fetchYouTubeVideoDetails(videoIds, apiKey, 'snippet');
        const thumbnails = items
          .slice(0, 3)
          .map((item) => item.snippet.thumbnails?.medium?.url || `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`);
        return { name: ch.name, handle: ch.handle, channelId: ch.channelId, thumbnails };
      }),
    );
  }, 43200);

  return data;
}

/**
 * A carousel of "popular new videos" across the curated channels for a
 * language: the latest few uploads from each channel, ranked by view count.
 * Used above the channel list in the Videos tab.
 */
export async function getChannelHighlights(lang = 'en', userRegion) {
  const channels = CHANNELS_BY_LANG[lang];
  if (!channels) {
    const err = new Error('No channels for this language');
    err.status = 404;
    throw err;
  }

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

export async function getChannelDetail(handle, lang = 'en', userRegion) {
  const channel = findChannelByHandle(handle);
  if (!channel) {
    const err = new Error('Channel not found');
    err.status = 404;
    throw err;
  }

  const { userRegion: resolvedUserRegion } = resolveUserRegion(lang, userRegion);
  // cache key bumped to channel4 — response now carries view_count per video.
  const cacheKey = `channel4:${handle}:${resolvedUserRegion}`;
  const apiKey = getYouTubeApiKey();

  const { data } = await cachedFetch(cacheKey, async () => {
    const videoIds = await fetchYouTubePlaylistVideoIds(channel.uploadsPlaylist, apiKey);
    if (videoIds.length === 0) {
      return { channel: { name: channel.name, handle: channel.handle }, videos: [] };
    }
    // Include statistics so the client can sort by view count ("most popular").
    const items = await fetchYouTubeVideoDetails(videoIds, apiKey, 'snippet,contentDetails,statistics');
    const videos = filterAndMapTrendingItems(items, resolvedUserRegion, { skipCaptionFilter: true });
    videos.sort((a, b) => (b.has_captions ? 1 : 0) - (a.has_captions ? 1 : 0));
    return { channel: { name: channel.name, handle: channel.handle }, videos };
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
