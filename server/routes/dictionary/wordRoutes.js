import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../auth.js';
import { validate } from '../../lib/validate.js';
import { validTimeZone } from '../../lib/srsUpdate.js';
import { asyncHandler } from '../../lib/httpErrors.js';
import { setFallbackDiagnosticHeader } from '../../lib/fallbackDiagnostics.js';
import { dictionaryWordService } from '../../services/dictionaryWordService.js';

const uuidParam = z.object({ id: z.string().uuid('Invalid ID') });
const listWordsQuery = z.object({
  timeZone: z.string().max(100).optional(),
  targetLanguage: z.string().max(20).optional(),
});
const updateWordBody = z.object({
  word: z.string().min(1).optional(),
  translation: z.string().optional(),
  definition: z.string().optional(),
  example_sentence: z.string().nullable().optional(),
  sentence_translation: z.string().nullable().optional(),
  part_of_speech: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  image_term: z.string().nullable().optional(),
});
const saveWordBody = z.object({
  word: z.string().min(1, 'word is required'),
  translation: z.string().optional(), definition: z.string().optional(), target_language: z.string().optional(),
  sentence_context: z.string().optional(), frequency: z.number().nullable().optional(),
  frequency_count: z.number().nullable().optional(), example_sentence: z.string().nullable().optional(),
  sentence_translation: z.string().nullable().optional(), part_of_speech: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(), lemma: z.string().nullable().optional(),
  forms: z.string().nullable().optional(), surface_form: z.string().nullable().optional(),
  image_term: z.string().nullable().optional(), shared_entry_id: z.string().uuid().nullable().optional(),
  timeZone: z.string().max(100).optional(),
});
const addFormBody = z.object({ form: z.string().min(1, 'form is required') });

export function createDictionaryWordRoutes({ service = dictionaryWordService } = {}) {
  const router = Router();

  router.get('/api/dictionary/words', authMiddleware, validate({ query: listWordsQuery }), asyncHandler(async (req, res) => {
    return res.json(await service.list(req.userId, req.query.targetLanguage));
  }));

  router.post('/api/dictionary/words', authMiddleware, validate({ body: saveWordBody }), asyncHandler(async (req, res) => {
    const outcome = await service.save(req.userId, req.body, {
      timeZone: validTimeZone(req.body.timeZone),
      correlationId: req.id,
    });
    if (outcome.diagnostic) setFallbackDiagnosticHeader(res, outcome.diagnostic);
    return res.status(outcome.status).json(outcome.body);
  }));

  router.patch('/api/dictionary/words/:id', authMiddleware, validate({ params: uuidParam, body: updateWordBody }), asyncHandler(async (req, res) => {
    return res.json(await service.update(req.userId, req.params.id, req.body));
  }));

  router.post('/api/dictionary/words/:id/forms', authMiddleware, validate({ params: uuidParam, body: addFormBody }), asyncHandler(async (req, res) => {
    return res.json(await service.addForm(req.userId, req.params.id, req.body.form));
  }));

  router.delete('/api/dictionary/words/:id', authMiddleware, validate({ params: uuidParam }), asyncHandler(async (req, res) => {
    await service.remove(req.userId, req.params.id);
    return res.status(204).end();
  }));

  return router;
}
