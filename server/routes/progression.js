import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';
import { validate } from '../lib/validate.js';
import { validTimeZone } from '../lib/srsUpdate.js';
import { armWildRecall, answerWildRecall, clickWildRecall, pendingWildRecall, progressionSnapshot } from '../lib/progression.js';

const router = Router();
const timeZone = z.object({ timeZone: z.string().max(100).optional() });
const armBody = timeZone.extend({ wordId: z.string().uuid() });
const answerBody = timeZone.extend({ challengeId: z.string().uuid(), optionId: z.string().uuid() });
const clickBody = timeZone.extend({ challengeId: z.string().uuid() });
const accentBody = z.object({ accent: z.enum(['indigo', 'teal', 'coral', 'gold']), timeZone: z.string().max(100).optional() });

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

router.post('/api/progression/wild-recall/click', authMiddleware, validate({ body: clickBody }), async (req, res) => {
  try {
    return res.json(await clickWildRecall(pool, req.userId, req.body.challengeId, validTimeZone(req.body.timeZone)));
  } catch (err) {
    req.log.error({ err }, 'Click wild recall error');
    return res.status(500).json({ error: err.message || 'Failed to record recall click' });
  }
});

router.patch('/api/progression/accent', authMiddleware, validate({ body: accentBody }), async (req, res) => {
  try {
    const zone = validTimeZone(req.body.timeZone);
    const snapshot = await progressionSnapshot(pool, req.userId, zone);
    if (!snapshot.level.unlockedAccents.includes(req.body.accent)) {
      return res.status(403).json({ error: 'That accent is still locked' });
    }
    await pool.query('UPDATE users SET progression_accent = $2 WHERE id = $1', [req.userId, req.body.accent]);
    return res.json(await progressionSnapshot(pool, req.userId, zone));
  } catch (err) {
    req.log.error({ err }, 'Update progression accent error');
    return res.status(500).json({ error: 'Failed to update progression accent' });
  }
});

export default router;
