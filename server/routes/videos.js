import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import { validate } from '../lib/validate.js';
import { asyncHandler } from '../lib/httpErrors.js';
import rateLimit from 'express-rate-limit';
import { fetchYouTubeTranscript } from '../services/videoTranscriptFetcher.js';
import { checkVideoPlayability, fetchRelatedVideos, fetchTimedTranscript } from '../services/mediaWorkerService.js';
import { normalizeFallbackDiagnostic } from '../lib/fallbackDiagnostics.js';
import {
  createVideoFromUrl,
  getVideoDetail,
  listVideos,
  retryVideoTranscriptExtraction,
  uploadClientTranscript,
} from '../services/videoTranscriptService.js';
import {
  getTrendingVideosForLanguage,
  searchVideosForLanguage,
  searchVideosAndChannelsForUser,
  getChannelSummariesForUser,
  getChannelHighlights,
  getChannelDetail,
  getChannelSubscription,
  getSubscriptionFeed,
  getShortsFeed,
  getLessonSummaries,
  getLessonDetail,
  subscribeToChannel,
  unsubscribeFromChannel,
} from '../services/videoCatalogService.js';

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

const uuidParam = z.object({
  id: z.string().uuid(),
});

const transcriptQuery = z.object({
  youtubeId: z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'Invalid YouTube video ID'),
  lang: z.string().min(2).max(20).default('en'),
});

const playabilityBody = z.object({
  videoIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).min(1).max(50),
});
const transcriptUploadBody = z.object({
  segments: z.array(z.object({
    offset: z.number().nonnegative(),
    duration: z.number().positive().max(3_600_000),
    text: z.string().max(10_000),
  }).strict()).max(20_000),
}).strict();

const mediaLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId,
  message: {
    error: 'Media request limit reached. Please try again in a minute.',
    diagnostic: {
      code: 'media_rate_limited',
      severity: 'warning',
      title: 'Media request limit reached',
      message: 'Polycast paused media-provider requests for one minute.',
      source: 'server.media',
      operation: 'quota',
    },
  },
});


const youtubeIdParam = z.object({ youtubeId: z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'Invalid YouTube video ID') });

router.get('/api/videos/transcript/youtube', authMiddleware, mediaLimiter, validate({ query: transcriptQuery }), asyncHandler(async (req, res) => {
  try {
    return res.json(await fetchTimedTranscript(req.query.youtubeId, req.query.lang, {
      userId: req.userId, correlationId: req.id,
    }));
  } catch (primaryError) {
    const result = await fetchYouTubeTranscript(req.query.youtubeId, req.query.lang, undefined, { skipWorker: true });
    return res.json({
      success: true,
      kind: 'human',
      selectedLanguage: req.query.lang,
      ...result,
      fallback_notices: [normalizeFallbackDiagnostic({
        code: 'transcript_worker_fallback',
        severity: 'warning',
        title: 'Transcript provider fallback used',
        message: `The primary caption provider failed, so Polycast used ${result.source}.`,
        source: 'server.video',
        operation: 'fetch-transcript',
        detail: `${primaryError.message}${primaryError.fallbackNotices?.length ? `; workerDiagnostic=${primaryError.fallbackNotices.map((notice) => notice.code).join(',')}` : ''}`,
      }, { correlationId: req.id }), ...(result.fallback_notices || [])],
    });
  }
}));

router.get('/api/videos/related/:youtubeId', authMiddleware, mediaLimiter, validate({ params: youtubeIdParam }), asyncHandler(async (req, res) => {
  return res.json(await fetchRelatedVideos(req.params.youtubeId, { userId: req.userId, correlationId: req.id }));
}));

router.post('/api/videos/playability', authMiddleware, mediaLimiter, validate({ body: playabilityBody }), asyncHandler(async (req, res) => {
  return res.json({
    success: true,
    results: await checkVideoPlayability(req.body.videoIds, { userId: req.userId, correlationId: req.id }),
  });
}));

router.get('/api/videos', authMiddleware, asyncHandler(async (_req, res) => res.json(await listVideos())));

router.post('/api/videos', authMiddleware, validate({ body: addVideoBody }), asyncHandler(async (req, res) => {
  const { url, language = 'en' } = req.body;
  const { created, video } = await createVideoFromUrl(url, language);
  return res.status(created ? 201 : 200).json(video);
}));

router.get('/api/videos/trending', authMiddleware, asyncHandler(async (req, res) => {
  return res.json(await getTrendingVideosForLanguage(String(req.query.lang || 'en').toLowerCase(), req.query.userRegion?.toString()));
}));

router.get('/api/videos/search', authMiddleware, validate({ query: videoSearchQuery }), asyncHandler(async (req, res) => {
  return res.json(await searchVideosForLanguage(req.query.q.trim(), String(req.query.lang || 'en').toLowerCase(), req.query.userRegion?.toString()));
}));

router.get('/api/videos/search/full', authMiddleware, validate({ query: videoSearchQuery }), asyncHandler(async (req, res) => {
  return res.json(await searchVideosAndChannelsForUser(req.userId, req.query.q.trim(), String(req.query.lang || 'en').toLowerCase(), req.query.userRegion?.toString()));
}));

router.get('/api/videos/channels', authMiddleware, asyncHandler(async (req, res) => {
  return res.json(await getChannelSummariesForUser(req.userId, String(req.query.lang || 'en').toLowerCase()));
}));

router.get('/api/videos/subscriptions', authMiddleware, asyncHandler(async (req, res) => {
  return res.json(await getSubscriptionFeed(req.userId, String(req.query.lang || 'en').toLowerCase(), req.query.userRegion?.toString()));
}));

router.get('/api/videos/channels/:handle/subscription', authMiddleware, asyncHandler(async (req, res) => {
  return res.json(await getChannelSubscription(req.userId, String(req.query.lang || 'en').toLowerCase(), req.params.handle));
}));

router.post('/api/videos/channels/:handle/subscription', authMiddleware, asyncHandler(async (req, res) => {
  return res.json(await subscribeToChannel(req.userId, String(req.query.lang || 'en').toLowerCase(), req.params.handle));
}));

router.delete('/api/videos/channels/:handle/subscription', authMiddleware, asyncHandler(async (req, res) => {
  return res.json(await unsubscribeFromChannel(req.userId, String(req.query.lang || 'en').toLowerCase(), req.params.handle));
}));

router.get('/api/videos/highlights', authMiddleware, asyncHandler(async (req, res) => {
  return res.json(await getChannelHighlights(String(req.query.lang || 'en').toLowerCase(), req.query.userRegion?.toString()));
}));

router.get('/api/videos/shorts', authMiddleware, asyncHandler(async (req, res) => {
  return res.json(await getShortsFeed(req.userId, String(req.query.lang || 'en').toLowerCase(), req.query.userRegion?.toString(), req.query.cursor?.toString()));
}));

router.get('/api/videos/channel/:handle', authMiddleware, asyncHandler(async (req, res) => {
  return res.json(await getChannelDetail(req.params.handle, String(req.query.lang || 'en').toLowerCase(), req.query.userRegion?.toString(), req.query.pageToken?.toString()));
}));

router.get('/api/videos/lessons', authMiddleware, asyncHandler(async (req, res) => {
  return res.json(await getLessonSummaries(String(req.query.lang || 'en').toLowerCase(), req.query.userRegion?.toString()));
}));

router.get('/api/videos/lesson/:id', authMiddleware, asyncHandler(async (req, res) => {
  return res.json(await getLessonDetail(req.params.id, String(req.query.lang || 'en').toLowerCase(), req.query.userRegion?.toString()));
}));

router.get('/api/videos/:id', authMiddleware, validate({ params: uuidParam }), asyncHandler(async (req, res) => res.json(await getVideoDetail(req.params.id))));

router.post('/api/videos/:id/transcript/retry', authMiddleware, validate({ params: uuidParam }), asyncHandler(async (req, res) => {
  return res.json(await retryVideoTranscriptExtraction(req.params.id));
}));

router.put('/api/videos/:id/transcript', authMiddleware, validate({ params: uuidParam, body: transcriptUploadBody }), asyncHandler(async (req, res) => {
  return res.json(await uploadClientTranscript(req.params.id, req.body.segments));
}));

export default router;
