import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';
import { enrichWord as enrichWordHelper, callGemini, searchPixabay, searchAllImages, fetchWiktSenses } from '../enrichWord.js';
import { validate } from '../lib/validate.js';

const router = Router();

const uuidParam = z.object({ id: z.string().uuid('Invalid ID') });

const lookupQuery = z.object({
  word: z.string().min(1, 'word is required'),
  sentence: z.string().min(1, 'sentence is required'),
  nativeLang: z.string().min(1, 'nativeLang is required'),
  targetLang: z.string().optional(),
});

const wiktLookupQuery = z.object({
  word: z.string().min(1, 'word is required'),
  targetLang: z.string().min(1, 'targetLang is required'),
  nativeLang: z.string().min(1, 'nativeLang is required'),
});

const translateBody = z.object({
  sentence: z.string().min(1, 'sentence is required'),
  toLang: z.string().min(1, 'toLang is required'),
  fromLang: z.string().optional(),
});

const enrichBody = z.object({
  word: z.string().min(1, 'word is required'),
  sentence: z.string().min(1, 'sentence is required'),
  nativeLang: z.string().min(1, 'nativeLang is required'),
  targetLang: z.string().optional(),
  senseIndex: z.number().optional(),
});

const imageProxyQuery = z.object({
  url: z.string().startsWith('https://pixabay.com/', 'Only Pixabay URLs are proxied'),
});

const imageSearchQuery = z.object({
  q: z.string().min(1, 'q is required'),
});

const wordImageBody = z.object({
  image_url: z.string().min(1, 'image_url is required'),
});

const reviewBody = z.object({
  answer: z.enum(['again', 'hard', 'good', 'easy'], { message: 'answer must be again, hard, good, or easy' }),
});

const saveWordBody = z.object({
  word: z.string().min(1, 'word is required'),
  translation: z.string().optional(),
  definition: z.string().optional(),
  target_language: z.string().optional(),
  sentence_context: z.string().optional(),
  frequency: z.number().nullable().optional(),
  frequency_count: z.number().nullable().optional(),
  example_sentence: z.string().nullable().optional(),
  part_of_speech: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  lemma: z.string().nullable().optional(),
  forms: z.string().nullable().optional(),
  image_term: z.string().nullable().optional(),
});

/**
 * GET /api/dictionary/lookup?word=X&sentence=Y&nativeLang=Z&targetLang=W
 * Uses Gemini to provide translation, definition, and POS.
 */
router.get('/api/dictionary/lookup', authMiddleware, validate({ query: lookupQuery }), async (req, res) => {
  const { word, sentence, nativeLang, targetLang } = req.query;

  try {
    // Fetch Wiktionary senses when targetLang is available (for sense-aware picking)
    let wiktSenses = [];
    if (targetLang) {
      try {
        wiktSenses = await fetchWiktSenses(word.toLowerCase(), targetLang, nativeLang);
      } catch (err) {
        req.log.error({ err }, 'fetchWiktSenses error in lookup');
      }
    }

    const hasSenses = wiktSenses.length > 0;
    const senseBlock = hasSenses
      ? `\nHere are the dictionary senses for "${word}":\n${wiktSenses.map((s, i) => `${i}: [${s.pos}] ${s.gloss}`).join('\n')}\n`
      : '';
    const jsonKeys = hasSenses
      ? `{"valid":true/false,"translation":"...","definition":"...","part_of_speech":"...","sense_index":N,"lemma":"..."}`
      : `{"valid":true/false,"translation":"...","definition":"...","part_of_speech":"...","lemma":"..."}`;
    const senseIndexDesc = hasSenses
      ? `\n- "sense_index": the integer index (0-${wiktSenses.length - 1}) of the sense above that best matches how "${word}" is used in the sentence. Use -1 if none match.`
      : '';

    const prompt = `Translate and define the ${targetLang || 'foreign'} word "${word}". Use the surrounding sentence to determine the correct sense: "${sentence}". The user's native language is ${nativeLang}.

If this word is not a recognized word in ${targetLang || 'the target language'}, set valid to false and leave other fields empty.
${senseBlock}
Return a JSON object with exactly these keys:
${jsonKeys}

- "valid": true if this is a real word in ${targetLang || 'the target language'}, false otherwise (numbers, gibberish, fragments, etc.)
- "translation": the standard ${nativeLang} translation of "${word}" in this sense — give the general-purpose dictionary translation, not a sentence-specific paraphrase, 1-3 words max
- "definition": what this word means in ${nativeLang}, 12 words max, no markdown — define the word itself, not its role in the sentence
- "part_of_speech": one of noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle${senseIndexDesc}
- "lemma": The dictionary/base form of this word in the target language.
  For verbs: the infinitive (e.g. "to work" in English, "trabajar" in Spanish).
  For nouns: the singular form (e.g. "cat" not "cats").
  For adjectives/adverbs: the positive form (e.g. "big" not "bigger").
  If the word is already in its base form, return it unchanged.

Respond with ONLY the JSON object, no other text.`;

    const raw = await callGemini(prompt, {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 200,
      responseMimeType: 'application/json',
    });

    const parsed = JSON.parse(raw);
    const valid = parsed.valid ?? true;
    if (valid && !parsed.definition) {
      req.log.error('Gemini lookup returned incomplete JSON: %s', raw.slice(0, 300));
    }
    const translation = parsed.translation || '';
    const definition = parsed.definition || '';
    const part_of_speech = parsed.part_of_speech || null;
    const lemma = parsed.lemma || null;

    // Resolve sense_index + matched_gloss from Wiktionary senses
    let sense_index = null;
    let matched_gloss = null;
    if (wiktSenses.length > 0) {
      const idx = parsed.sense_index;
      if (typeof idx === 'number' && idx >= 0 && idx < wiktSenses.length) {
        sense_index = idx;
        matched_gloss = wiktSenses[idx].gloss;
      }
    }

    return res.json({ word, valid, translation, definition, part_of_speech, sense_index, matched_gloss, lemma });
  } catch (err) {
    req.log.error({ err }, 'Dictionary lookup error');
    return res.status(500).json({ error: err.message || 'Lookup failed' });
  }
});

/**
 * GET /api/dictionary/wikt-lookup?word=X&targetLang=Y&nativeLang=Z
 * Proxies to WiktApi for structured Wiktionary definitions.
 */
router.get('/api/dictionary/wikt-lookup', authMiddleware, validate({ query: wiktLookupQuery }), async (req, res) => {
  const { word, targetLang, nativeLang } = req.query;

  try {
    const senses = await fetchWiktSenses(word.toLowerCase(), targetLang, nativeLang);
    return res.json({ word, senses });
  } catch (err) {
    req.log.error({ err }, 'WiktApi network error');
    return res.status(502).json({ error: 'WiktApi request failed' });
  }
});

/**
 * POST /api/dictionary/translate
 * Translate a full sentence via Google Cloud Translation API (v2).
 * Used for transcript panel translations.
 */
router.post('/api/dictionary/translate', authMiddleware, validate({ body: translateBody }), async (req, res) => {
  const { sentence, fromLang, toLang } = req.body;

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
      req.log.error('Google Translate API error: %s', err);
      throw new Error('Translation request failed');
    }

    const data = await response.json();
    const translation = data.data?.translations?.[0]?.translatedText;
    if (!translation) {
      req.log.error('Google Translate returned unexpected structure: %s', JSON.stringify(data).slice(0, 500));
    }

    return res.json({ translation: translation || '' });
  } catch (err) {
    req.log.error({ err }, 'Sentence translation error');
    return res.status(500).json({ error: err.message || 'Translation failed' });
  }
});

/**
 * POST /api/dictionary/enrich
 * Full enrichment call (translation, definition, POS, frequency, example).
 * Called when the user saves a word — quality over speed.
 */
router.post('/api/dictionary/enrich', authMiddleware, validate({ body: enrichBody }), async (req, res) => {
  const { word, sentence, nativeLang, targetLang, senseIndex } = req.body;

  try {
    const result = await enrichWordHelper(word, sentence, nativeLang, targetLang, senseIndex ?? null);
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, 'Dictionary enrich error');
    return res.status(500).json({ error: err.message || 'Enrichment failed' });
  }
});

// ---------------------------------------------------------------------------
// Image search + update
// ---------------------------------------------------------------------------

/**
 * GET /api/dictionary/image-proxy?url=URL
 * Proxy a Pixabay image through the server so the browser never hits Pixabay directly.
 * Avoids CDN rate-limiting (429) when many images load at once, and complies with
 * Pixabay's policy against hotlinking webformatURLs from end-user browsers.
 */
router.get('/api/dictionary/image-proxy', authMiddleware, validate({ query: imageProxyQuery }), async (req, res) => {
  const { url } = req.query;
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      req.log.error('[image-proxy] Upstream returned %d for %s', upstream.status, url);
      return res.status(upstream.status).end();
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = await upstream.arrayBuffer();
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(Buffer.from(buffer));
  } catch (err) {
    req.log.error({ err }, '[image-proxy] fetch error');
    return res.status(502).end();
  }
});

/**
 * GET /api/dictionary/image-search?q=TERM
 * Search Pixabay for stock photos.
 */
router.get('/api/dictionary/image-search', authMiddleware, validate({ query: imageSearchQuery }), async (req, res) => {
  const { q } = req.query;

  try {
    const images = await searchAllImages(q, 12);
    return res.json({ images });
  } catch (err) {
    req.log.error({ err }, 'Image search error');
    return res.status(500).json({ error: 'Image search failed' });
  }
});

/**
 * PATCH /api/dictionary/words/:id/image
 * Update the image_url on a saved word.
 */
router.patch('/api/dictionary/words/:id/image', authMiddleware, validate({ params: uuidParam, body: wordImageBody }), async (req, res) => {
  const { image_url } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE saved_words SET image_url = $1
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [image_url, req.params.id, req.userId],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Word not found' });
    return res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, 'Error updating word image');
    return res.status(500).json({ error: 'Failed to update image' });
  }
});

// ---------------------------------------------------------------------------
// New cards for today (never-reviewed, capped by daily_new_limit)
// ---------------------------------------------------------------------------

/**
 * GET /api/dictionary/new-today -- New (never-reviewed) cards for today
 */
router.get('/api/dictionary/new-today', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sw.* FROM saved_words sw
       JOIN users u ON u.id = sw.user_id
       WHERE sw.user_id = $1
         AND sw.target_language = u.target_language
         AND sw.due_at IS NULL
         AND sw.last_reviewed_at IS NULL
       ORDER BY CASE WHEN sw.priority = true THEN 0 ELSE 1 END ASC, sw.frequency DESC NULLS LAST, sw.created_at ASC
       LIMIT (SELECT daily_new_limit FROM users WHERE id = $1)`,
      [req.userId],
    );
    return res.json(rows);
  } catch (err) {
    req.log.error({ err }, 'Error fetching new-today words');
    return res.status(500).json({ error: 'Failed to fetch new words' });
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
         AND target_language = (SELECT target_language FROM users WHERE id = $1)
         AND (due_at <= NOW() OR due_at IS NULL)
       ORDER BY
         CASE WHEN learning_step IS NOT NULL THEN 0
              WHEN due_at IS NOT NULL THEN 1
              ELSE 2 END,
         due_at ASC NULLS LAST,
         CASE WHEN due_at IS NULL AND priority = true THEN 0 ELSE 1 END ASC,
         frequency DESC NULLS LAST,
         created_at ASC`,
      [req.userId],
    );
    return res.json(rows);
  } catch (err) {
    req.log.error({ err }, 'Error fetching due words');
    return res.status(500).json({ error: 'Failed to fetch due words' });
  }
});

/**
 * PATCH /api/dictionary/words/:id/review -- Record an Anki-style SRS review
 * Body: { answer: 'again' | 'hard' | 'good' | 'easy' }
 */
router.patch('/api/dictionary/words/:id/review', authMiddleware, validate({ params: uuidParam, body: reviewBody }), async (req, res) => {
  const { answer } = req.body;

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
    req.log.error({ err }, 'Error reviewing word');
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
      `SELECT * FROM saved_words WHERE user_id = $1
         AND target_language = (SELECT target_language FROM users WHERE id = $1)
       ORDER BY created_at DESC`,
      [req.userId],
    );
    return res.json(rows);
  } catch (err) {
    req.log.error({ err }, 'Error fetching saved words');
    return res.status(500).json({ error: 'Failed to fetch saved words' });
  }
});

/**
 * POST /api/dictionary/words -- Save a word to the personal dictionary
 */
router.post('/api/dictionary/words', authMiddleware, validate({ body: saveWordBody }), async (req, res) => {
  const { word, translation, definition, target_language, sentence_context, frequency, frequency_count, example_sentence, part_of_speech, image_url, lemma, forms, image_term } = req.body;

  try {
    // Check if this exact definition already exists
    const { rows: existing } = await pool.query(
      `SELECT * FROM saved_words
       WHERE user_id = $1 AND word = $2
         AND target_language IS NOT DISTINCT FROM $3
         AND definition = $4`,
      [req.userId, word, target_language || null, definition || ''],
    );
    if (existing.length > 0) return res.status(200).json({ ...existing[0], _created: false });

    // Insert new definition
    const { rows } = await pool.query(
      `INSERT INTO saved_words (user_id, word, translation, definition, target_language, sentence_context, frequency, example_sentence, part_of_speech, image_url, lemma, forms, frequency_count, image_term)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [req.userId, word, translation || '', definition || '', target_language || null, sentence_context || null, frequency || null, example_sentence || null, part_of_speech || null, image_url || null, lemma || null, forms || null, frequency_count ?? null, image_term || null],
    );
    return res.status(201).json({ ...rows[0], _created: true });
  } catch (err) {
    req.log.error({ err }, 'Error saving word');
    return res.status(500).json({ error: 'Failed to save word' });
  }
});

/**
 * DELETE /api/dictionary/words/:id -- Remove a saved word
 */
router.delete('/api/dictionary/words/:id', authMiddleware, validate({ params: uuidParam }), async (req, res) => {
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
    req.log.error({ err }, 'Error deleting saved word');
    return res.status(500).json({ error: 'Failed to delete word' });
  }
});

export default router;
