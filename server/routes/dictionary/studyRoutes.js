import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../auth.js';
import { asyncHandler } from '../../lib/httpErrors.js';
import { validTimeZone } from '../../lib/srsUpdate.js';
import { validate } from '../../lib/validate.js';
import { dictionaryStudyService } from '../../services/dictionaryStudyService.js';
import { refreshScheduleIfNeeded } from './scheduleMaintenance.js';

const uuidParam = z.object({ id: z.string().uuid('Invalid ID') });
const calendarQuery = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  timeZone: z.string().max(100).optional(),
});
const calendarDayParam = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD') });
const wordsPageQuery = z.object({
  page: z.coerce.number().int().min(0).optional(), cursor: z.string().max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(), search: z.string().optional(),
  sort: z.enum(['queue', 'date', 'az', 'freq-high', 'freq-low', 'due']).optional(),
  timeZone: z.string().max(100).optional(),
});
const reviewBody = z.object({
  answer: z.enum(['again', 'good'], { message: 'answer must be again or good' }),
  timeZone: z.string().max(100).optional(), learningSessionId: z.string().uuid().optional(),
});
const dueQuery = z.object({
  timeZone: z.string().max(100).optional(), newLimitOverride: z.coerce.number().int().min(0).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(250).optional(), offset: z.coerce.number().int().min(0).max(5000).optional(),
});
const newWordPreviewQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).optional(), timeZone: z.string().max(100).optional() });
const widgetPreviewQuery = z.object({ limit: z.coerce.number().int().min(1).max(20).optional(), timeZone: z.string().max(100).optional() });
const timeZoneQuery = z.object({ timeZone: z.string().max(100).optional(), targetLanguage: z.string().max(20).optional() });
const queueReorderBody = z.object({
  items: z.array(z.object({ id: z.string().uuid('Invalid ID'), queue_position: z.number().int().min(0) })).min(1),
});

export function createDictionaryStudyRoutes({ service = dictionaryStudyService } = {}) {
  const router = Router();
  const scheduled = (handler) => asyncHandler(async (req, res) => {
    const timeZone = validTimeZone(req.query.timeZone);
    await refreshScheduleIfNeeded(req, res, timeZone);
    return handler(req, res, timeZone);
  });

  router.patch('/api/dictionary/queue-reorder', authMiddleware, validate({ body: queueReorderBody }), asyncHandler(async (req, res) => {
    await service.reorder(req.userId, req.body.items);
    return res.status(204).end();
  }));
  router.post('/api/dictionary/queue-rebuild', authMiddleware, asyncHandler(async (req, res) => {
    return res.json(await service.rebuildFrequencyOrder(req.userId));
  }));
  router.get('/api/dictionary/calendar', authMiddleware, validate({ query: calendarQuery }), asyncHandler(async (req, res) => {
    const { year, month, timeZone } = req.query;
    return res.json(await service.calendar(req.userId, year, month, validTimeZone(timeZone)));
  }));
  router.get('/api/dictionary/calendar/:date', authMiddleware, validate({ params: calendarDayParam, query: timeZoneQuery }), asyncHandler(async (req, res) => {
    return res.json(await service.calendarDay(req.userId, req.params.date, validTimeZone(req.query.timeZone)));
  }));
  router.get('/api/dictionary/new-today', authMiddleware, validate({ query: timeZoneQuery }), scheduled(async (req, res, timeZone) => {
    return res.json(await service.newToday(req.userId, timeZone));
  }));
  router.get('/api/dictionary/new-preview', authMiddleware, validate({ query: newWordPreviewQuery }), scheduled(async (req, res, timeZone) => {
    return res.json(await service.newPreview(req.userId, req.query.limit ?? 10, timeZone));
  }));
  router.get('/api/dictionary/widget-preview', authMiddleware, validate({ query: widgetPreviewQuery }), scheduled(async (req, res, timeZone) => {
    return res.json(await service.widgetPreview(req.userId, req.query.limit ?? 20, timeZone));
  }));
  router.get('/api/dictionary/study-overview', authMiddleware, validate({ query: timeZoneQuery }), scheduled(async (req, res, timeZone) => {
    return res.json(await service.studyOverview(req.userId, timeZone));
  }));
  router.get('/api/dictionary/due', authMiddleware, validate({ query: dueQuery }), scheduled(async (req, res, timeZone) => {
    return res.json(await service.due(req.userId, { ...req.query, timeZone }));
  }));
  router.patch('/api/dictionary/words/:id/review', authMiddleware, validate({ params: uuidParam, body: reviewBody }), asyncHandler(async (req, res) => {
    const result = await service.review(req.userId, req.params.id, {
      ...req.body,
      timeZone: validTimeZone(req.body.timeZone),
      idempotencyKey: req.get('Idempotency-Key'),
    });
    if (result.replayed) res.set('Idempotency-Replayed', 'true');
    return res.status(result.status).json(result.body);
  }));
  router.get('/api/dictionary/word-groups', authMiddleware, validate({ query: wordsPageQuery }), asyncHandler(async (req, res) => {
    return res.json(await service.groups(req.userId, { ...req.query, timeZone: validTimeZone(req.query.timeZone) }));
  }));
  return router;
}
