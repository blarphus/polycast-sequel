import { Router } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { authMiddleware } from './auth.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max (Whisper API limit)
});

// Lazy-init so the server starts even without the key
let openai = null;
function getOpenAI() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

/**
 * POST /api/transcribe
 * Accepts an audio file and returns a transcription via OpenAI Whisper.
 * Query param `language` is optional; when omitted Whisper auto-detects.
 */
router.post(
  '/api/transcribe',
  authMiddleware,
  upload.single('audio'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      // Build a File-like object from the buffer for the OpenAI SDK
      const file = new File([req.file.buffer], req.file.originalname || 'audio.webm', {
        type: req.file.mimetype || 'audio/webm',
      });

      const transcriptionParams = {
        model: 'whisper-1',
        file,
        response_format: 'verbose_json', // includes language detection
      };

      // Only set language if explicitly provided
      if (req.body.language || req.query.language) {
        transcriptionParams.language = req.body.language || req.query.language;
      }

      const transcription = await getOpenAI().audio.transcriptions.create(transcriptionParams);

      return res.json({
        text: transcription.text,
        language: transcription.language || null,
      });
    } catch (err) {
      console.error('Whisper transcription error:', err);

      if (err.status === 400) {
        return res.status(400).json({ error: 'Invalid audio file or format' });
      }

      return res.status(500).json({ error: 'Transcription failed' });
    }
  },
);

export default router;
