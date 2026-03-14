import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';
import { enrichWord as enrichWordHelper, searchAllImages, fetchWiktSenses } from '../enrichWord.js';
import { validate } from '../lib/validate.js';
import { computeNextReview } from '../lib/srsAlgorithm.js';
import { synthesizeVoiceFeedback } from '../services/ttsService.js';
import { resolveDictionaryLookup } from '../services/wordSemanticsService.js';
import { listDueWords, listNewTodayWords } from '../lib/dictionaryQueries.js';

const router = Router();

const uuidParam = z.object({ id: z.string().uuid('Invalid ID') });

const lookupQuery = z.object({
  word: z.string().min(1, 'word is required'),
  sentence: z.string().min(1, 'sentence is required'),
  nativeLang: z.string().min(1, 'nativeLang is required'),
  targetLang: z.string().optional(),
  isNative: z.string().optional(),
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

const queueReorderBody = z.object({
  items: z.array(z.object({
    id: z.string().uuid('Invalid ID'),
    queue_position: z.number().int().min(0),
  })).min(1),
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
  sentence_translation: z.string().nullable().optional(),
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
  const { word, sentence, nativeLang, targetLang, isNative } = req.query;

  try {
    const result = await resolveDictionaryLookup({
      word,
      sentence,
      nativeLang,
      targetLang,
      isNative: isNative === 'true',
    });
    return res.json(result);
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
    const sl = fromLang || 'auto';
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(toLang)}&dt=t&q=${encodeURIComponent(sentence)}`;
    const response = await fetch(url);
    if (!response.ok) {
      req.log.error('Google Translate error: status %d', response.status);
      throw new Error('Translation request failed');
    }

    const data = await response.json();
    const segments = data[0] || [];
    const translation = segments.map((seg) => seg[0]).join('');

    return res.json({ translation });
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
// TTS audio — cached per word
// ---------------------------------------------------------------------------

/**
 * GET /api/dictionary/words/:id/audio
 * Returns cached TTS audio (MP3) for a saved word, generating on first request.
 */
router.get('/api/dictionary/words/:id/audio', authMiddleware, validate({ params: uuidParam }), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT tts_audio, example_sentence, word, target_language FROM saved_words WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Word not found' });

    const row = rows[0];

    // Serve from cache if available
    if (row.tts_audio) {
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'private, max-age=31536000, immutable');
      return res.send(row.tts_audio);
    }

    // Generate TTS
    const text = row.example_sentence
      ? row.example_sentence.replace(/~([^~]+)~/g, '$1')
      : row.word;

    const audioBuffer = await synthesizeVoiceFeedback({
      text,
      languageCode: row.target_language,
    });

    // Cache in DB
    await pool.query(
      'UPDATE saved_words SET tts_audio = $1 WHERE id = $2 AND user_id = $3',
      [audioBuffer, req.params.id, req.userId],
    );

    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    return res.send(audioBuffer);
  } catch (err) {
    req.log.error({ err }, 'Error serving word audio');
    return res.status(500).json({ error: 'Failed to generate audio' });
  }
});

// ---------------------------------------------------------------------------
// Queue reorder — persist custom card ordering
// ---------------------------------------------------------------------------

/**
 * PATCH /api/dictionary/queue-reorder -- Persist drag-and-drop queue positions
 */
router.patch('/api/dictionary/queue-reorder', authMiddleware, validate({ body: queueReorderBody }), async (req, res) => {
  const { items } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { id, queue_position } of items) {
      const { rowCount } = await client.query(
        'UPDATE saved_words SET queue_position = $1 WHERE id = $2 AND user_id = $3',
        [queue_position, id, req.userId],
      );
      if (rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Word ${id} not found` });
      }
    }
    await client.query('COMMIT');
    return res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    req.log.error({ err }, 'Error reordering queue');
    return res.status(500).json({ error: 'Failed to reorder queue' });
  } finally {
    client.release();
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
    const { rows } = await listNewTodayWords(pool, req.userId);
    return res.json(rows);
  } catch (err) {
    req.log.error({ err }, 'Error fetching new-today words');
    return res.status(500).json({ error: 'Failed to fetch new words' });
  }
});

// ---------------------------------------------------------------------------
// SRS (Spaced Repetition) — Anki-style algorithm
// ---------------------------------------------------------------------------

/**
 * GET /api/dictionary/due -- Cards due for review + new cards
 */
router.get('/api/dictionary/due', authMiddleware, async (req, res) => {
  try {
    const { rows } = await listDueWords(pool, req.userId);
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
    const next = computeNextReview(card, answer);

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
        next.srs_interval,
        next.ease_factor,
        next.learning_step,
        String(next.due_seconds),
        next.correct_delta,
        next.incorrect_delta,
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
  const { word, translation, definition, target_language, sentence_context, frequency, frequency_count, example_sentence, sentence_translation, part_of_speech, image_url, lemma, forms, image_term } = req.body;

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
      `INSERT INTO saved_words (user_id, word, translation, definition, target_language, sentence_context, frequency, example_sentence, sentence_translation, part_of_speech, image_url, lemma, forms, frequency_count, image_term)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [req.userId, word, translation || '', definition || '', target_language || null, sentence_context || null, frequency || null, example_sentence || null, sentence_translation || null, part_of_speech || null, image_url || null, lemma || null, forms || null, frequency_count ?? null, image_term || null],
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
