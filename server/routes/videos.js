import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import { validate } from '../lib/validate.js';
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

router.get('/api/videos', authMiddleware, async (req, res) => {
  try {
    res.json(await listVideos());
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos failed');
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

router.post('/api/videos', authMiddleware, validate({ body: addVideoBody }), async (req, res) => {
  try {
    const { url, language = 'en' } = req.body;
    const { created, video } = await createVideoFromUrl(url, language);
    res.status(created ? 201 : 200).json(video);
  } catch (err) {
    req.log.error({ err }, 'POST /api/videos failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to add video' });
  }
});

router.get('/api/videos/trending', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const userRegion = req.query.userRegion?.toString();
    res.json(await getTrendingVideosForLanguage(lang, userRegion));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/trending failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch trending videos' });
  }
});

router.get('/api/videos/search', authMiddleware, validate({ query: videoSearchQuery }), async (req, res) => {
  try {
    const query = req.query.q.trim();
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const userRegion = req.query.userRegion?.toString();
    res.json(await searchVideosForLanguage(query, lang, userRegion));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/search failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to search videos' });
  }
});

router.get('/api/videos/search/full', authMiddleware, validate({ query: videoSearchQuery }), async (req, res) => {
  try {
    const query = req.query.q.trim();
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const userRegion = req.query.userRegion?.toString();
    res.json(await searchVideosAndChannelsForUser(req.userId, query, lang, userRegion));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/search/full failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to search videos and channels' });
  }
});

router.get('/api/videos/channels', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    res.json(await getChannelSummariesForUser(req.userId, lang));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/channels failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch channels' });
  }
});

router.get('/api/videos/subscriptions', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const userRegion = req.query.userRegion?.toString();
    res.json(await getSubscriptionFeed(req.userId, lang, userRegion));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/subscriptions failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch subscription videos' });
  }
});

router.get('/api/videos/channels/:handle/subscription', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    res.json(await getChannelSubscription(req.userId, lang, req.params.handle));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/channels/:handle/subscription failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch channel subscription' });
  }
});

router.post('/api/videos/channels/:handle/subscription', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    res.json(await subscribeToChannel(req.userId, lang, req.params.handle));
  } catch (err) {
    req.log.error({ err }, 'POST /api/videos/channels/:handle/subscription failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to subscribe to channel' });
  }
});

router.delete('/api/videos/channels/:handle/subscription', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    res.json(await unsubscribeFromChannel(req.userId, lang, req.params.handle));
  } catch (err) {
    req.log.error({ err }, 'DELETE /api/videos/channels/:handle/subscription failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to unsubscribe from channel' });
  }
});

router.get('/api/videos/highlights', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const userRegion = req.query.userRegion?.toString();
    res.json(await getChannelHighlights(lang, userRegion));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/highlights failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch highlights' });
  }
});

router.get('/api/videos/shorts', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const userRegion = req.query.userRegion?.toString();
    const cursor = req.query.cursor?.toString();
    res.json(await getShortsFeed(req.userId, lang, userRegion, cursor));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/shorts failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch shorts' });
  }
});

router.get('/api/videos/channel/:handle', authMiddleware, async (req, res) => {
  try {
    const { handle } = req.params;
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const userRegion = req.query.userRegion?.toString();
    const pageToken = req.query.pageToken?.toString();
    res.json(await getChannelDetail(handle, lang, userRegion, pageToken));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/channel/:handle failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch channel videos' });
  }
});

router.get('/api/videos/lessons', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const userRegion = req.query.userRegion?.toString();
    res.json(await getLessonSummaries(lang, userRegion));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/lessons failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch lessons' });
  }
});

router.get('/api/videos/lesson/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const lang = (req.query.lang || 'en').toString().toLowerCase();
    const userRegion = req.query.userRegion?.toString();
    res.json(await getLessonDetail(id, lang, userRegion));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/lesson/:id failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch lesson videos' });
  }
});

router.get('/api/videos/:id', authMiddleware, validate({ params: uuidParam }), async (req, res) => {
  try {
    res.json(await getVideoDetail(req.params.id));
  } catch (err) {
    req.log.error({ err }, 'GET /api/videos/:id failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch video' });
  }
});

router.post('/api/videos/:id/transcript/retry', authMiddleware, async (req, res) => {
  try {
    res.json(await retryVideoTranscriptExtraction(req.params.id));
  } catch (err) {
    req.log.error({ err }, 'POST /api/videos/:id/transcript/retry failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to retry transcript extraction' });
  }
});

router.put('/api/videos/:id/transcript', authMiddleware, async (req, res) => {
  try {
    res.json(await uploadClientTranscript(req.params.id, req.body.segments));
  } catch (err) {
    req.log.error({ err }, 'PUT /api/videos/:id/transcript failed');
    res.status(err.status || 500).json({ error: err.message || 'Failed to upload transcript' });
  }
});

export default router;
