import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';

const router = Router();

/**
 * GET /api/dictionary/lookup?word=X&sentence=Y&nativeLang=Z&targetLang=W
 * Uses Gemini to provide a structured translation + definition.
 */
router.get('/api/dictionary/lookup', authMiddleware, async (req, res) => {
  const { word, sentence, nativeLang, targetLang } = req.query;

  if (!word || !sentence) {
    return res.status(400).json({ error: 'word and sentence are required' });
  }

  if (!nativeLang) {
    return res.status(400).json({ error: 'nativeLang is required' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const prompt = `You are a language-learning assistant. A user clicked the word "${word}" in: "${sentence}".
${targetLang ? `The sentence is in ${targetLang}.` : ''}
The user's native language is ${nativeLang}.

Respond in EXACTLY this format (two parts separated by //):
TRANSLATION // DEFINITION

- TRANSLATION: The word translated into ${nativeLang}. Just the word(s), nothing else.
- DEFINITION: A brief explanation of how this word is used in the given sentence, in ${nativeLang}. 15 words max. No markdown.`;

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
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
    const raw =
      data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse: split on first "//"
    const sepIndex = raw.indexOf('//');
    let translation, definition;
    if (sepIndex !== -1) {
      translation = raw.slice(0, sepIndex).trim();
      definition = raw.slice(sepIndex + 2).trim();
    } else {
      translation = raw.trim();
      definition = '';
    }

    return res.json({ word, translation, definition });
  } catch (err) {
    console.error('Dictionary lookup error:', err);
    return res.status(500).json({ error: err.message || 'Lookup failed' });
  }
});

// ---------------------------------------------------------------------------
// Saved Words CRUD
// ---------------------------------------------------------------------------

/**
 * GET /api/dictionary/words -- List all saved words for the authenticated user
 */
router.get('/api/dictionary/words', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM saved_words WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId],
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching saved words:', err);
    return res.status(500).json({ error: 'Failed to fetch saved words' });
  }
});

/**
 * POST /api/dictionary/words -- Save a word to the personal dictionary
 */
router.post('/api/dictionary/words', authMiddleware, async (req, res) => {
  const { word, translation, definition, target_language, sentence_context } = req.body;

  if (!word) {
    return res.status(400).json({ error: 'word is required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO saved_words (user_id, word, translation, definition, target_language, sentence_context)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, word, target_language) DO NOTHING
       RETURNING *`,
      [req.userId, word, translation || '', definition || '', target_language || null, sentence_context || null],
    );

    if (rows.length > 0) {
      return res.status(201).json(rows[0]);
    }

    // Already existed — fetch and return it
    const existing = await pool.query(
      'SELECT * FROM saved_words WHERE user_id = $1 AND word = $2 AND target_language IS NOT DISTINCT FROM $3',
      [req.userId, word, target_language || null],
    );
    return res.status(200).json(existing.rows[0]);
  } catch (err) {
    console.error('Error saving word:', err);
    return res.status(500).json({ error: 'Failed to save word' });
  }
});

/**
 * DELETE /api/dictionary/words/:id -- Remove a saved word
 */
router.delete('/api/dictionary/words/:id', authMiddleware, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM saved_words WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId],
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Word not found' });
    }
    return res.status(204).end();
  } catch (err) {
    console.error('Error deleting saved word:', err);
    return res.status(500).json({ error: 'Failed to delete word' });
  }
});

export default router;
