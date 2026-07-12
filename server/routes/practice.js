import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';
import { validTimeZone } from '../lib/srsUpdate.js';
import { validate } from '../lib/validate.js';
import { asyncHandler } from '../lib/httpErrors.js';
import {
  answerVocabularyExercise,
  completeLearningSession,
  createLearningSession,
} from '../services/learningSessionService.js';

const router = Router();

const createSessionBody = z.object({
  kind: z.enum(['flashcards', 'vocabulary']),
  sourceVideoId: z.string().uuid().nullable().optional(),
  timeZone: z.string().max(100).optional(),
});
const sessionParam = z.object({ id: z.string().uuid('Invalid session ID') });
const answerBody = z.object({
  exerciseId: z.string().uuid(),
  response: z.union([
    z.object({ optionId: z.string().uuid() }),
    z.object({ text: z.string().max(300) }),
    z.object({ pairs: z.array(z.object({ leftId: z.string().uuid(), rightId: z.string().uuid() })).max(10) }),
  ]),
});
const completionBody = z.object({ timeZone: z.string().max(100).optional() });

router.post('/api/learning-sessions', authMiddleware, validate({ body: createSessionBody }), asyncHandler(async (req, res) => {
  const result = await createLearningSession(pool, req.userId, {
    ...req.body,
    timeZone: validTimeZone(req.body.timeZone),
    correlationId: req.id,
  });
  return res.status(201).json(result);
}));

router.post('/api/learning-sessions/:id/answers', authMiddleware, validate({ params: sessionParam, body: answerBody }), async (req, res) => {
  try {
    return res.json(await answerVocabularyExercise(
      pool,
      req.userId,
      req.params.id,
      req.body.exerciseId,
      req.body.response,
    ));
  } catch (err) {
    req.log.error({ err }, 'Answer vocabulary exercise error');
    return res.status(err.status || 500).json({ error: err.message || 'Failed to record answer' });
  }
});

router.post('/api/learning-sessions/:id/complete', authMiddleware, validate({ params: sessionParam, body: completionBody }), async (req, res) => {
  try {
    return res.json(await completeLearningSession(
      pool,
      req.userId,
      req.params.id,
      validTimeZone(req.body.timeZone),
    ));
  } catch (err) {
    req.log.error({ err }, 'Complete learning session error');
    return res.status(err.status || 500).json({ error: err.message || 'Failed to complete learning session' });
  }
});

router.get('/api/practice/drill-sessions', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, tense_key, verb_filter, question_count, correct_count, duration_seconds, created_at
       FROM drill_sessions WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.userId],
    );
    return res.json({ sessions: rows });
  } catch (err) {
    req.log.error({ err }, 'Error fetching drill sessions');
    return res.status(500).json({ error: 'Failed to fetch drill sessions' });
  }
});

const drillSessionBody = z.object({
  tense_key: z.string().min(1).max(30),
  verb_filter: z.string().min(1).max(15),
  question_count: z.number().int().min(1).max(100),
  correct_count: z.number().int().min(0),
  duration_seconds: z.number().int().min(0),
});

router.post('/api/practice/drill-sessions', authMiddleware, validate({ body: drillSessionBody }), async (req, res) => {
  const { tense_key, verb_filter, question_count, correct_count, duration_seconds } = req.body;
  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO drill_sessions (user_id, tense_key, verb_filter, question_count, correct_count, duration_seconds)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.userId, tense_key, verb_filter, question_count, correct_count, duration_seconds],
    );
    return res.json({ id: row.id });
  } catch (err) {
    req.log.error({ err }, 'Error saving drill session');
    return res.status(500).json({ error: 'Failed to save drill session' });
  }
});

export default router;
