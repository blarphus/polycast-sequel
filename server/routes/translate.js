import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import { validate } from '../lib/validate.js';
import { translateText } from '../lib/googleTranslate.js';

const router = Router();

const phraseBody = z.object({
  phrase: z.string().min(1).max(500),
  nativeLang: z.string().min(1),
  targetLang: z.string().min(1),
});

router.post('/api/translate/phrase', authMiddleware, validate({ body: phraseBody }), async (req, res) => {
  try {
    const { phrase, nativeLang, targetLang } = req.body;

    const translation = await translateText(phrase, targetLang, nativeLang);

    res.json({ translation });
  } catch (err) {
    req.log.error({ err }, 'POST /api/translate/phrase failed');
    res.status(500).json({ error: 'Translation failed' });
  }
});

export default router;
