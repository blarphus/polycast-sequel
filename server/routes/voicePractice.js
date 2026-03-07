import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import { validate } from '../lib/validate.js';
import pool from '../db.js';
import {
  completeVoicePracticeSession,
  createVoicePracticeSession,
  getVoicePracticeSession,
  gradeVoicePracticeTurn,
} from '../services/voicePracticeSessionService.js';
import { synthesizeVoiceFeedback } from '../services/ttsService.js';

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

const speakBody = z.object({
  text: z.string().min(1, 'Text is required').max(400),
  languageCode: z.string().min(2).optional(),
});

const transcribeBody = z.object({
  audioBase64: z.string().min(1, 'Audio payload is required'),
  mimeType: z.string().min(1).optional(),
  nativeLanguage: z.string().min(2).optional(),
  targetLanguage: z.string().min(2).optional(),
});

async function transcribeVoiceAudio({
  audioBase64,
  mimeType,
  nativeLanguage,
  targetLanguage,
}) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY is not configured');
  }

  const bytes = Buffer.from(audioBase64, 'base64');
  const form = new FormData();
  form.append('model', 'voxtral-mini-latest');
  const languageContext = [
    nativeLanguage ? `Native language: ${nativeLanguage}.` : null,
    targetLanguage ? `Target language being learned: ${targetLanguage}.` : null,
    'Transcribe exactly what the speaker says.',
    'The speaker may mix words from both languages in one response.',
    'Do not normalize toward an expected answer. Just transcribe the spoken words as faithfully as possible.',
  ].filter(Boolean).join(' ');
  form.append('context', languageContext);
  form.append('file', new Blob([bytes], { type: mimeType || 'audio/webm' }), 'voice-practice.webm');

  const response = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(errBody || 'Mistral transcription failed');
  }

  const data = await response.json();
  return typeof data.text === 'string' ? data.text : '';
}

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

router.post('/api/practice/voice/speak', authMiddleware, validate({ body: speakBody }), async (req, res) => {
  try {
    const audioBuffer = await synthesizeVoiceFeedback({
      text: req.body.text,
      languageCode: req.body.languageCode,
    });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(audioBuffer);
  } catch (err) {
    req.log.error({ err }, 'POST /api/practice/voice/speak error');
    return res.status(500).json({ error: err.message || 'Failed to synthesize voice feedback' });
  }
});

router.post('/api/practice/voice/transcribe', authMiddleware, validate({ body: transcribeBody }), async (req, res) => {
  try {
    const transcript = await transcribeVoiceAudio({
      audioBase64: req.body.audioBase64,
      mimeType: req.body.mimeType,
      nativeLanguage: req.body.nativeLanguage,
      targetLanguage: req.body.targetLanguage,
    });
    return res.json({ transcript });
  } catch (err) {
    req.log.error({ err }, 'POST /api/practice/voice/transcribe error');
    return res.status(500).json({ error: err.message || 'Failed to transcribe voice audio' });
  }
});

export default router;
