import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import { validate } from '../lib/validate.js';
import { createRealtimeVoiceSession } from '../services/openaiRealtimeService.js';
import {
  completeVoicePracticeSession,
  createVoicePracticeSession,
  getVoicePracticeSession,
  gradeVoicePracticeTurn,
} from '../services/voicePracticeSessionService.js';

const router = Router();

const createSessionBody = z.object({
  count: z.number().int().min(5).max(20).optional(),
  feedbackLanguageMode: z.enum(['native', 'target']).optional(),
});

const sessionIdParam = z.object({
  id: z.string().uuid('Invalid session ID'),
});

const gradeBody = z.object({
  sentenceId: z.string().uuid('Invalid sentence ID'),
  userTranscript: z.string().min(1, 'Transcript is required'),
  feedbackLanguageMode: z.enum(['native', 'target']).optional(),
});

const completeBody = z.object({
  answeredCount: z.number().int().min(0),
  correctCount: z.number().int().min(0),
  partialCount: z.number().int().min(0),
  incorrectCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  durationSeconds: z.number().int().min(0),
  feedbackLanguageMode: z.enum(['native', 'target']).optional(),
  issueCounts: z.record(z.number().int().min(0)).optional(),
});

const tokenBody = z.object({
  nativeLanguage: z.string().min(2),
  targetLanguage: z.string().min(2),
  feedbackLanguageMode: z.enum(['native', 'target']).optional(),
});

router.post('/api/practice/voice/sessions', authMiddleware, validate({ body: createSessionBody }), async (req, res) => {
  try {
    const data = await createVoicePracticeSession({
      userId: req.userId,
      count: req.body.count || 10,
      feedbackLanguageMode: req.body.feedbackLanguageMode || 'native',
    });
    return res.status(201).json(data);
  } catch (err) {
    req.log.error({ err }, 'POST /api/practice/voice/sessions error');
    return res.status(err.status || 500).json({ error: err.message || 'Failed to create voice practice session' });
  }
});

router.get('/api/practice/voice/sessions/:id', authMiddleware, validate({ params: sessionIdParam }), async (req, res) => {
  try {
    const session = await getVoicePracticeSession(req.params.id, req.userId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    return res.json(session);
  } catch (err) {
    req.log.error({ err }, 'GET /api/practice/voice/sessions/:id error');
    return res.status(500).json({ error: err.message || 'Failed to load voice practice session' });
  }
});

router.post('/api/practice/voice/sessions/:id/grade', authMiddleware, validate({ params: sessionIdParam, body: gradeBody }), async (req, res) => {
  try {
    const result = await gradeVoicePracticeTurn({
      sessionId: req.params.id,
      userId: req.userId,
      sentenceId: req.body.sentenceId,
      userTranscript: req.body.userTranscript,
      feedbackLanguageMode: req.body.feedbackLanguageMode || 'native',
    });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, 'POST /api/practice/voice/sessions/:id/grade error');
    return res.status(err.status || 500).json({ error: err.message || 'Failed to grade voice practice answer' });
  }
});

router.post('/api/practice/voice/sessions/:id/complete', authMiddleware, validate({ params: sessionIdParam, body: completeBody }), async (req, res) => {
  try {
    const summary = await completeVoicePracticeSession({
      sessionId: req.params.id,
      userId: req.userId,
      answeredCount: req.body.answeredCount,
      correctCount: req.body.correctCount,
      partialCount: req.body.partialCount,
      incorrectCount: req.body.incorrectCount,
      skippedCount: req.body.skippedCount,
      durationSeconds: req.body.durationSeconds,
      feedbackLanguageMode: req.body.feedbackLanguageMode || 'native',
      issueCounts: req.body.issueCounts || {},
    });
    return res.json(summary);
  } catch (err) {
    req.log.error({ err }, 'POST /api/practice/voice/sessions/:id/complete error');
    return res.status(err.status || 500).json({ error: err.message || 'Failed to complete voice practice session' });
  }
});

router.post('/api/practice/voice/realtime-token', authMiddleware, validate({ body: tokenBody }), async (req, res) => {
  try {
    const session = await createRealtimeVoiceSession({
      nativeLanguage: req.body.nativeLanguage,
      targetLanguage: req.body.targetLanguage,
      feedbackLanguageMode: req.body.feedbackLanguageMode || 'native',
    });
    return res.json(session);
  } catch (err) {
    req.log.error({ err }, 'POST /api/practice/voice/realtime-token error');
    return res.status(500).json({ error: err.message || 'Failed to create realtime token' });
  }
});

export default router;
