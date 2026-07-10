import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';
import { validate } from '../lib/validate.js';
import { validTimeZone } from '../lib/srsUpdate.js';
import { armWildRecall, answerWildRecall, pendingWildRecall, progressionSnapshot } from '../lib/progression.js';

const router = Router();
const timeZone = z.object({ timeZone: z.string().max(100).optional() });
const armBody = timeZone.extend({ wordId: z.string().uuid() });
const answerBody = timeZone.extend({ challengeId: z.string().uuid(), optionId: z.string().uuid() });

router.get('/api/progression', authMiddleware, validate({ query: timeZone }), async (req, res) => {
  try {
    const zone = validTimeZone(req.query.timeZone);
    const [progression, pending] = await Promise.all([
      progressionSnapshot(pool, req.userId, zone),
      pendingWildRecall(pool, req.userId),
    ]);
    return res.json({ ...progression, activeChallenge: pending ? {
      id: pending.id, savedWordId: pending.saved_word_id, word: pending.word,
      lemma: pending.lemma, forms: pending.forms, options: pending.options,
    } : null });
  } catch (err) {
    req.log.error({ err }, 'GET progression error');
    return res.status(500).json({ error: 'Failed to load progression' });
  }
});

router.post('/api/progression/wild-recall/arm', authMiddleware, validate({ body: armBody }), async (req, res) => {
  try {
    return res.json(await armWildRecall(pool, req.userId, req.body.wordId, validTimeZone(req.body.timeZone)));
  } catch (err) {
    req.log.error({ err }, 'Arm wild recall error');
    return res.status(500).json({ error: err.message || 'Failed to prepare recall challenge' });
  }
});

router.post('/api/progression/wild-recall/answer', authMiddleware, validate({ body: answerBody }), async (req, res) => {
  try {
    return res.json(await answerWildRecall(pool, req.userId, req.body.challengeId, req.body.optionId, validTimeZone(req.body.timeZone)));
  } catch (err) {
    req.log.error({ err }, 'Answer wild recall error');
    return res.status(500).json({ error: err.message || 'Failed to record recall answer' });
  }
});

export default router;
