import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';

const router = Router();

async function callGemini(prompt, generationConfig = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    console.error('Gemini API error:', err);
    throw new Error('Gemini request failed');
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

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
    const prompt = `A user learning ${targetLang || 'a language'} clicked "${word}" in: "${sentence}". Their native language is ${nativeLang}.

Return a JSON object with exactly these keys:
{"translation":"...","definition":"...","part_of_speech":"..."}

- "translation": the word translated into ${nativeLang}, just the word(s)
- "definition": brief usage explanation in ${nativeLang}, 12 words max, no markdown
- "part_of_speech": one of noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle

Respond with ONLY the JSON object, no other text.`;

    const raw = await callGemini(prompt, {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 128,
      responseMimeType: 'application/json',
    }) || '{}';

    const parsed = JSON.parse(raw);
    const translation = parsed.translation || '';
    const definition = parsed.definition || '';
    const part_of_speech = parsed.part_of_speech || null;

    return res.json({ word, translation, definition, part_of_speech });
  } catch (err) {
    console.error('Dictionary lookup error:', err);
    return res.status(500).json({ error: err.message || 'Lookup failed' });
  }
});

/**
 * POST /api/dictionary/translate
 * Translate a full sentence via Google Cloud Translation API (v2).
 * Used for transcript panel translations.
 */
router.post('/api/dictionary/translate', authMiddleware, async (req, res) => {
  const { sentence, fromLang, toLang } = req.body;

  if (!sentence || !toLang) {
    return res.status(400).json({ error: 'sentence and toLang are required' });
  }

  try {
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_TRANSLATE_API_KEY is not configured');

    const params = new URLSearchParams({
      q: sentence,
      target: toLang,
      key: apiKey,
      format: 'text',
    });
    if (fromLang) params.set('source', fromLang);

    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2?${params}`,
      { method: 'POST' },
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('Google Translate API error:', err);
      throw new Error('Translation request failed');
    }

    const data = await response.json();
    const translation = data.data?.translations?.[0]?.translatedText || '';

    return res.json({ translation });
  } catch (err) {
    console.error('Sentence translation error:', err);
    return res.status(500).json({ error: err.message || 'Translation failed' });
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

    const raw = await callGemini(prompt);

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
// SRS (Spaced Repetition) — Anki-style algorithm
// ---------------------------------------------------------------------------

const LEARNING_STEPS = [60, 600];        // 1 min, 10 min
const GRADUATING_INTERVAL = 86400;       // 1 day
const EASY_GRADUATING_INTERVAL = 345600; // 4 days
const RELEARNING_STEP = 600;             // 10 min
const MIN_EASE = 1.3;
const LAPSE_INTERVAL_FACTOR = 0.1;       // Again in review: new = old × 0.1
const MIN_REVIEW_INTERVAL = 86400;       // 1 day minimum

/**
 * GET /api/dictionary/due -- Cards due for review + new cards
 */
router.get('/api/dictionary/due', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM saved_words WHERE user_id = $1
         AND (due_at <= NOW() OR due_at IS NULL)
       ORDER BY
         CASE WHEN learning_step IS NOT NULL THEN 0
              WHEN due_at IS NOT NULL THEN 1
              ELSE 2 END,
         due_at ASC NULLS LAST,
         frequency DESC NULLS LAST,
         created_at ASC`,
      [req.userId],
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching due words:', err);
    return res.status(500).json({ error: 'Failed to fetch due words' });
  }
});

/**
 * PATCH /api/dictionary/words/:id/review -- Record an Anki-style SRS review
 * Body: { answer: 'again' | 'hard' | 'good' | 'easy' }
 */
router.patch('/api/dictionary/words/:id/review', authMiddleware, async (req, res) => {
  const { answer } = req.body;

  if (!answer || !['again', 'hard', 'good', 'easy'].includes(answer)) {
    return res.status(400).json({ error: 'answer must be again, hard, good, or easy' });
  }

  try {
    const { rows: existing } = await pool.query(
      'SELECT * FROM saved_words WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId],
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Word not found' });
    }

    const card = existing[0];
    const isLearning = card.learning_step !== null || card.srs_interval === 0;
    const isRelearning = card.learning_step !== null && card.srs_interval > 0;

    let newInterval = card.srs_interval;
    let newEase = card.ease_factor;
    let newStep = card.learning_step;
    let dueSeconds;

    if (isLearning) {
      // ---- Learning / Relearning phase ----
      const step = card.learning_step ?? 0;

      switch (answer) {
        case 'again':
          newStep = 0;
          dueSeconds = LEARNING_STEPS[0]; // 1 min
          break;
        case 'hard':
          newStep = step;
          dueSeconds = step === 0 ? 360 : LEARNING_STEPS[1]; // 6 min or 10 min
          break;
        case 'good':
          if (step >= LEARNING_STEPS.length - 1) {
            // Graduate
            newStep = null;
            if (isRelearning) {
              // Keep existing srs_interval for relearning graduation
              dueSeconds = card.srs_interval;
            } else {
              newInterval = GRADUATING_INTERVAL;
              dueSeconds = GRADUATING_INTERVAL;
            }
          } else {
            newStep = step + 1;
            dueSeconds = LEARNING_STEPS[step + 1];
          }
          break;
        case 'easy':
          newStep = null;
          newInterval = EASY_GRADUATING_INTERVAL;
          newEase = Math.max(newEase + 0.15, MIN_EASE);
          dueSeconds = EASY_GRADUATING_INTERVAL;
          break;
      }
    } else {
      // ---- Review phase (graduated cards) ----
      const oldInterval = card.srs_interval;

      switch (answer) {
        case 'again':
          newEase = Math.max(newEase - 0.20, MIN_EASE);
          newInterval = Math.max(Math.round(oldInterval * LAPSE_INTERVAL_FACTOR), MIN_REVIEW_INTERVAL);
          newStep = 0; // Enter relearning
          dueSeconds = RELEARNING_STEP; // 10 min
          break;
        case 'hard':
          newEase = Math.max(newEase - 0.15, MIN_EASE);
          newInterval = Math.max(Math.round(oldInterval * 1.2), MIN_REVIEW_INTERVAL);
          dueSeconds = newInterval;
          break;
        case 'good':
          newInterval = Math.max(Math.round(oldInterval * newEase), MIN_REVIEW_INTERVAL);
          dueSeconds = newInterval;
          break;
        case 'easy':
          newEase = Math.max(newEase + 0.15, MIN_EASE);
          newInterval = Math.max(Math.round(oldInterval * newEase * 1.3), MIN_REVIEW_INTERVAL);
          dueSeconds = newInterval;
          break;
      }
    }

    const { rows: updated } = await pool.query(
      `UPDATE saved_words
       SET srs_interval = $1,
           ease_factor = $2,
           learning_step = $3,
           due_at = NOW() + ($4 || ' seconds')::INTERVAL,
           last_reviewed_at = NOW(),
           correct_count = correct_count + $5,
           incorrect_count = incorrect_count + $6
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
      [
        newInterval,
        newEase,
        newStep,
        String(dueSeconds),
        answer === 'again' ? 0 : 1,
        answer === 'again' ? 1 : 0,
        req.params.id,
        req.userId,
      ],
    );

    return res.json(updated[0]);
  } catch (err) {
    console.error('Error reviewing word:', err);
    return res.status(500).json({ error: 'Failed to record review' });
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

export default router;
