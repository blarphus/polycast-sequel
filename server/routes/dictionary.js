import { Router } from 'express';
import { authMiddleware } from '../auth.js';

const router = Router();

/**
 * GET /api/dictionary/lookup?word=X&sentence=Y&targetLang=Z
 * Uses Gemini to explain how a word is used in a sentence.
 */
router.get('/api/dictionary/lookup', authMiddleware, async (req, res) => {
  const { word, sentence, targetLang } = req.query;

  if (!word || !sentence) {
    return res.status(400).json({ error: 'word and sentence are required' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const prompt = `You are a language assistant. A user clicked the word "${word}" in: "${sentence}".
${targetLang ? `The sentence is in ${targetLang}.` : ''}
Provide a concise definition or translation (if non-English) and explain how the word is used in this sentence. 2-3 sentences max. No markdown.`;

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('Gemini API error:', err);
      throw new Error('Gemini request failed');
    }

    const data = await response.json();
    const explanation =
      data.candidates?.[0]?.content?.parts?.[0]?.text || 'No explanation available.';

    return res.json({ word, explanation });
  } catch (err) {
    console.error('Dictionary lookup error:', err);
    return res.status(500).json({ error: err.message || 'Lookup failed' });
  }
});

export default router;
