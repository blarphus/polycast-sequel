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

    const prompt = `Translate "${word}" from "${sentence}"${targetLang ? ` (${targetLang})` : ''} for a ${nativeLang} speaker.
Reply EXACTLY: TRANSLATION // DEFINITION // PART_OF_SPEECH
- TRANSLATION: word(s) in ${nativeLang}
- DEFINITION: brief usage explanation in ${nativeLang}, 12 words max, no markdown
- PART_OF_SPEECH: one of noun,verb,adjective,adverb,pronoun,preposition,conjunction,interjection,article,particle`;

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
          generationConfig: {
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: 128,
          },
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

    // Parse: split on "//" into 3 fields (popup only)
    const parts = raw.split('//').map((s) => s.trim());
    const translation = parts[0] || '';
    const definition = parts[1] || '';
    const part_of_speech = parts[2] || null;

    return res.json({ word, translation, definition, part_of_speech });
  } catch (err) {
    console.error('Dictionary lookup error:', err);
    return res.status(500).json({ error: err.message || 'Lookup failed' });
  }
});

/**
 * POST /api/dictionary/enrich
 * Full enrichment call (translation, definition, POS, frequency, example).
 * Called when the user saves a word — quality over speed.
 */
router.post('/api/dictionary/enrich', authMiddleware, async (req, res) => {
  const { word, sentence, nativeLang, targetLang } = req.body;

  if (!word || !sentence || !nativeLang) {
    return res.status(400).json({ error: 'word, sentence, and nativeLang are required' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

    const prompt = `You are a language-learning assistant. A user clicked the word "${word}" in: "${sentence}".
${targetLang ? `The sentence is in ${targetLang}.` : ''}
The user's native language is ${nativeLang}.

Respond in EXACTLY this format (five parts separated by " // "):
TRANSLATION // DEFINITION // PART_OF_SPEECH // FREQUENCY // EXAMPLE

- TRANSLATION: The word translated into ${nativeLang}. Just the word(s), nothing else.
- DEFINITION: A brief explanation of how this word is used in the given sentence, in ${nativeLang}. 15 words max. No markdown.
- PART_OF_SPEECH: One of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle. Lowercase English.
- FREQUENCY: An integer 1-10 rating how common this word is for a language learner:
  1-2: Rare/specialized words most learners won't encounter
  3-4: Uncommon words that appear in specific contexts
  5-6: Moderately common words useful for intermediate learners
  7-8: Common everyday words important for conversation
  9-10: Essential high-frequency words (top 500 most used)
- EXAMPLE: A short example sentence in ${targetLang || 'the target language'} using the word. Wrap the word with tildes like ~word~. Keep it under 15 words.`;

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
      console.error('Gemini enrich API error:', err);
      throw new Error('Gemini enrich request failed');
    }

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const parts = raw.split('//').map((s) => s.trim());
    const translation = parts[0] || '';
    const definition = parts[1] || '';
    const part_of_speech = parts[2] || null;
    const frequency = parts[3] ? parseInt(parts[3], 10) || null : null;
    const example_sentence = parts[4] || null;

    return res.json({ word, translation, definition, part_of_speech, frequency, example_sentence });
  } catch (err) {
    console.error('Dictionary enrich error:', err);
    return res.status(500).json({ error: err.message || 'Enrichment failed' });
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
  const { word, translation, definition, target_language, sentence_context, frequency, example_sentence, part_of_speech } = req.body;

  if (!word) {
    return res.status(400).json({ error: 'word is required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO saved_words (user_id, word, translation, definition, target_language, sentence_context, frequency, example_sentence, part_of_speech)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, word, target_language) DO NOTHING
       RETURNING *`,
      [req.userId, word, translation || '', definition || '', target_language || null, sentence_context || null, frequency || null, example_sentence || null, part_of_speech || null],
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

// ---------------------------------------------------------------------------
// Transcript Retrieval
// ---------------------------------------------------------------------------

/**
 * GET /api/calls/:id/transcript -- Fetch stored transcript entries for a call
 */
router.get('/api/calls/:id/transcript', authMiddleware, async (req, res) => {
  const callId = req.params.id;

  try {
    // Verify the caller is a participant in this call
    const callCheck = await pool.query(
      'SELECT id FROM calls WHERE id = $1 AND (caller_id = $2 OR callee_id = $2)',
      [callId, req.userId],
    );

    if (callCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Call not found' });
    }

    const { rows } = await pool.query(
      `SELECT te.id, te.user_id, u.display_name, u.username, te.text, te.language, te.created_at
       FROM transcript_entries te
       JOIN users u ON u.id = te.user_id
       WHERE te.call_id = $1
       ORDER BY te.created_at ASC`,
      [callId],
    );

    return res.json(rows);
  } catch (err) {
    console.error('Error fetching transcript:', err);
    return res.status(500).json({ error: 'Failed to fetch transcript' });
  }
});

export default router;
