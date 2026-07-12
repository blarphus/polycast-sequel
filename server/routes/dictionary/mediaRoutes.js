import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../auth.js';
import { normalizeFallbackDiagnostic, setFallbackDiagnosticHeader } from '../../lib/fallbackDiagnostics.js';
import { asyncHandler } from '../../lib/httpErrors.js';
import { validate } from '../../lib/validate.js';
import { dictionaryMediaService } from '../../services/dictionaryMediaService.js';

const uuidParam = z.object({ id: z.string().uuid('Invalid ID') });
const imageProxyQuery = z.object({
  url: z.string().regex(/^https?:\/\/(?:cdn\.)?pixabay\.com\//, 'Only Pixabay URLs are proxied'),
});
const imageSearchQuery = z.object({ q: z.string().min(1, 'q is required') });
const wordImageBody = z.object({
  image_url: z.string().min(1, 'image_url is required'),
  image_term: z.string().nullable().optional(),
});

export function createDictionaryMediaRoutes({ service = dictionaryMediaService } = {}) {
  const router = Router();

  router.get('/api/dictionary/image-proxy', validate({ query: imageProxyQuery }), asyncHandler(async (req, res) => {
    const image = await service.proxyImage(req.query.url);
    res.set('Content-Type', image.contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(image.data);
  }));

  router.get('/api/dictionary/image/:id', validate({ params: uuidParam }), asyncHandler(async (req, res) => {
    const image = await service.cachedImage(req.params.id);
    res.set('Content-Type', image.contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(image.data);
  }));

  router.get('/api/dictionary/image-search', authMiddleware, validate({ query: imageSearchQuery }), asyncHandler(async (req, res) => {
    const result = await service.search(req.query.q, { correlationId: req.id });
    return res.json({ images: result.images, fallback_notices: result.fallbackNotices });
  }));

  router.patch('/api/dictionary/words/:id/image', authMiddleware, validate({ params: uuidParam, body: wordImageBody }), asyncHandler(async (req, res) => {
    return res.json(await service.updateWordImage(req.userId, req.params.id, req.body));
  }));

  router.get('/api/dictionary/words/:id/audio', authMiddleware, validate({ params: uuidParam }), asyncHandler(async (req, res) => {
    const audio = await service.wordAudio(req.userId, req.params.id);
    if (audio.usedFallback) {
      const diagnostic = normalizeFallbackDiagnostic({
        code: 'tts_openai_fallback_used',
        severity: 'warning',
        title: 'Alternate speech voice used',
        message: `The primary device-compatible voice is unavailable for ${audio.languageCode || 'this language'}, so Polycast used the OpenAI speech voice.`,
        source: 'server.dictionary',
        operation: 'word-audio',
        correlationId: req.id,
        detail: `audioSource=${audio.source}; language=${audio.languageCode || 'unknown'}`,
      });
      req.log.warn({ fallback: diagnostic, userId: req.userId }, 'Dictionary TTS fallback used');
      setFallbackDiagnosticHeader(res, diagnostic);
      res.set('X-Polycast-TTS-Fallback', 'openai');
    }
    res.set('Content-Type', audio.contentType);
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    return res.send(audio.audioBuffer);
  }));

  return router;
}
