import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import { validate } from '../lib/validate.js';

const router = Router();

const phraseBody = z.object({
  phrase: z.string().min(1).max(500),
  nativeLang: z.string().min(1),
  targetLang: z.string().min(1),
});

router.post('/api/translate/phrase', authMiddleware, validate({ body: phraseBody }), async (req, res) => {
  try {
    const { phrase, nativeLang, targetLang } = req.body;

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(targetLang)}&tl=${encodeURIComponent(nativeLang)}&dt=t&q=${encodeURIComponent(phrase)}`;
    const gRes = await fetch(url);
    if (!gRes.ok) {
      throw new Error(`Google Translate responded ${gRes.status}`);
    }

    const data = await gRes.json();
    // Response format: [[["translated text","original text",null,null,N]], ...]
    const segments = data[0] || [];
    const translation = segments.map((seg) => seg[0]).join('');

    res.json({ translation });
  } catch (err) {
    req.log.error({ err }, 'POST /api/translate/phrase failed');
    res.status(500).json({ error: 'Translation failed' });
  }
});

export default router;
