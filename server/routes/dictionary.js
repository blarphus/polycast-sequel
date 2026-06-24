import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';
import { enrichWord as enrichWordHelper, fetchWiktSenses } from '../enrichWord.js';
import { searchAllImages } from '../lib/imageSearch.js';
import { getImageBytes } from '../lib/imageCache.js';
import { validate } from '../lib/validate.js';
import { translateText } from '../lib/googleTranslate.js';
import { applySrsReview, validTimeZone } from '../lib/srsUpdate.js';
import { generateStageSentence } from '../lib/stageSentence.js';
import logger from '../logger.js';
import { audioContentType, synthesizeVoiceFeedback } from '../services/ttsService.js';
import { resolveDictionaryLookup, resolveDictionaryLookupFast, explainWordInContext, explainSelectionInContext } from '../services/wordSemanticsService.js';
import { listDictionaryGroupPage, listDueWords, listNewTodayWords, listNewWordPreview, listStudyOverview, listCalendarCounts, listCalendarDayWords, invalidateDictionaryCache } from '../lib/dictionaryQueries.js';
import { mergeForm } from '../lib/normalizeWordFields.js';

const router = Router();

function usesTtsFallback(languageCode) {
  const language = String(languageCode || 'en').trim().toLowerCase().split(/[-_]/)[0];
  return language !== 'en' && language !== 'es';
}

const uuidParam = z.object({ id: z.string().uuid('Invalid ID') });

const lookupQuery = z.object({
  word: z.string().min(1, 'word is required'),
  sentence: z.string().min(1, 'sentence is required'),
  nativeLang: z.string().min(1, 'nativeLang is required'),
  targetLang: z.string().optional(),
  isNative: z.string().optional(),
  // Optional wider passage (rolling ~50-word transcript window) used only by
  // /explain to read how the word is used beyond the single on-screen line.
  context: z.string().optional(),
});

const explainSelectionBody = z.object({
  selection: z.string().trim().min(1, 'selection is required').max(2000),
  context: z.string().trim().min(1, 'context is required').max(10000),
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
  url: z.string().regex(/^https?:\/\/(?:cdn\.)?pixabay\.com\//, 'Only Pixabay URLs are proxied'),
});

const imageSearchQuery = z.object({
  q: z.string().min(1, 'q is required'),
});

const calendarQuery = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

const calendarDayParam = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

const wordsPageQuery = z.object({
  page: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
  sort: z.enum(['queue', 'date', 'az', 'freq-high', 'freq-low', 'due']).optional(),
});

const wordImageBody = z.object({
  image_url: z.string().min(1, 'image_url is required'),
  image_term: z.string().nullable().optional(),
});

const updateWordBody = z.object({
  word: z.string().min(1).optional(),
  translation: z.string().optional(),
  definition: z.string().optional(),
  example_sentence: z.string().nullable().optional(),
  sentence_translation: z.string().nullable().optional(),
  part_of_speech: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  image_term: z.string().nullable().optional(),
});

const reviewBody = z.object({
  answer: z.enum(['again', 'good'], { message: 'answer must be again or good' }),
  timeZone: z.string().max(100).optional(),
});

const dueQuery = z.object({
  timeZone: z.string().max(100).optional(),
  newLimitOverride: z.coerce.number().int().min(0).max(50).optional(),
});

const newWordPreviewQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const savedWordsQuery = z.object({
  targetLanguage: z.string().max(20).optional(),
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
  // The exact surface form the learner tapped. Always merged into `forms` so
  // that conjugation highlights even when the inflection table omitted it.
  surface_form: z.string().nullable().optional(),
  image_term: z.string().nullable().optional(),
});

const addFormBody = z.object({
  form: z.string().min(1, 'form is required'),
});

/**
 * GET /api/dictionary/lookup?word=X&sentence=Y&nativeLang=Z&targetLang=W
 * Uses Gemini to provide translation, definition, and POS.
 */
router.get('/api/dictionary/lookup', authMiddleware, validate({ query: lookupQuery }), async (req, res) => {
  const { word, sentence, nativeLang, targetLang, isNative } = req.query;

  try {
    // Fast path: DB senses + minimal Gemini sense-pick + Google Translate
    if (isNative !== 'true') {
      const fast = await resolveDictionaryLookupFast({ word, sentence, nativeLang, targetLang, userId: req.userId });
      if (fast) return res.json(fast);
    }
    // Fallback: full Gemini path (no DB senses, or native word clicks)
    // FLAGGED FOR DELETION — only the fallback + native case still needed
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
 * GET /api/dictionary/explain?word=X&sentence=Y&nativeLang=Z&targetLang=W
 * Asks Gemini to explain the word's meaning specifically in its sentence context.
 */
router.get('/api/dictionary/explain', authMiddleware, validate({ query: lookupQuery }), async (req, res) => {
  const { word, sentence, nativeLang, targetLang, context } = req.query;
  try {
    const result = await explainWordInContext({ word, sentence, nativeLang, targetLang, context });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, 'Dictionary explain error');
    return res.status(500).json({ error: err.message || 'Explain failed' });
  }
});

/**
 * POST /api/dictionary/explain-selection
 * Explains selected text using its surrounding paragraph for context.
 */
router.post('/api/dictionary/explain-selection', authMiddleware, validate({ body: explainSelectionBody }), async (req, res) => {
  const { selection, context, nativeLang, targetLang } = req.body;
  try {
    const result = await explainSelectionInContext({ selection, context, nativeLang, targetLang });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, 'Dictionary selection explain error');
    return res.status(500).json({ error: err.message || 'Selection explanation failed' });
  }
});

/**
 * GET /api/dictionary/wikt-lookup?word=X&targetLang=Y&nativeLang=Z
 * Queries local Wiktionary DB for structured definitions.
 */
router.get('/api/dictionary/wikt-lookup', authMiddleware, validate({ query: wiktLookupQuery }), async (req, res) => {
  const { word, targetLang, nativeLang } = req.query;

  try {
    const { senses } = await fetchWiktSenses(word.toLowerCase(), targetLang, nativeLang);
    return res.json({ word, senses });
  } catch (err) {
    req.log.error({ err }, 'Wiktionary DB query error');
    return res.status(502).json({ error: 'Dictionary lookup failed' });
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
    const translation = await translateText(sentence, fromLang || 'auto', toLang);

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
router.get('/api/dictionary/image-proxy', validate({ query: imageProxyQuery }), async (req, res) => {
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
 * GET /api/dictionary/image/:id
 * Serve a cached image's bytes. enrichWord stores the chosen flashcard image
 * here and saves `/api/dictionary/image/<id>` as the word's image_url, so the
 * picture is served from our own copy rather than a (rotting) upstream link.
 */
router.get('/api/dictionary/image/:id', validate({ params: uuidParam }), async (req, res) => {
  try {
    const img = await getImageBytes(req.params.id);
    if (!img) return res.status(404).end();
    res.set('Content-Type', img.content_type);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(img.data);
  } catch (err) {
    req.log.error({ err }, '[image] fetch error');
    return res.status(500).end();
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
  const { image_url, image_term } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE saved_words SET image_url = $1, image_term = COALESCE($4, image_term)
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [image_url, req.params.id, req.userId, image_term ?? null],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Word not found' });
    invalidateDictionaryCache(req.userId);
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
      'SELECT tts_audio, word, target_language FROM saved_words WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Word not found' });

    const row = rows[0];

    // Serve from cache if available
    if (row.tts_audio) {
      if (usesTtsFallback(row.target_language)) res.set('X-Polycast-TTS-Fallback', 'openai');
      res.set('Content-Type', audioContentType(row.tts_audio));
      res.set('Cache-Control', 'private, max-age=31536000, immutable');
      return res.send(row.tts_audio);
    }

    // Generate TTS. This cached per-word clip is the WORD's pronunciation (used
    // by the flashcard front, recall prompts, and the popup speaker). Full
    // example sentences are synthesized on the fly by the caller instead.
    const { audioBuffer, usedFallback } = await synthesizeVoiceFeedback({
      text: row.word,
      languageCode: row.target_language,
    });

    // Cache in DB
    await pool.query(
      'UPDATE saved_words SET tts_audio = $1 WHERE id = $2 AND user_id = $3',
      [audioBuffer, req.params.id, req.userId],
    );

    if (usedFallback) res.set('X-Polycast-TTS-Fallback', 'openai');
    res.set('Content-Type', audioContentType(audioBuffer));
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
    invalidateDictionaryCache(req.userId);
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
// Review calendar
// ---------------------------------------------------------------------------

/**
 * GET /api/dictionary/calendar?year=2026&month=3 -- Due counts per day for a month
 */
router.get('/api/dictionary/calendar', authMiddleware, validate({ query: calendarQuery }), async (req, res) => {
  try {
    const { year, month } = req.query;
    const result = await listCalendarCounts(pool, req.userId, year, month);
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, 'Error fetching calendar counts');
    return res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});

/**
 * GET /api/dictionary/calendar/:date -- Words due on a specific day
 */
router.get('/api/dictionary/calendar/:date', authMiddleware, validate({ params: calendarDayParam }), async (req, res) => {
  try {
    const words = await listCalendarDayWords(pool, req.userId, req.params.date);
    return res.json(words);
  } catch (err) {
    req.log.error({ err }, 'Error fetching calendar day words');
    return res.status(500).json({ error: 'Failed to fetch day words' });
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

/**
 * GET /api/dictionary/new-preview -- Upcoming new cards without changing the queue
 */
router.get('/api/dictionary/new-preview', authMiddleware, validate({ query: newWordPreviewQuery }), async (req, res) => {
  try {
    const { rows } = await listNewWordPreview(pool, req.userId, req.query.limit ?? 10);
    return res.json(rows);
  } catch (err) {
    req.log.error({ err }, 'Error fetching new-word preview');
    return res.status(500).json({ error: 'Failed to fetch new-word preview' });
  }
});

// ---------------------------------------------------------------------------
// SRS (Spaced Repetition) — Anki-style algorithm
// ---------------------------------------------------------------------------

/**
 * GET /api/dictionary/study-overview -- Counts for the practice start screen:
 * reviews due now, never-seen cards available, and the daily-new limit.
 */
router.get('/api/dictionary/study-overview', authMiddleware, async (req, res) => {
  try {
    const overview = await listStudyOverview(pool, req.userId);
    return res.json(overview);
  } catch (err) {
    req.log.error({ err }, 'Error fetching study overview');
    return res.status(500).json({ error: 'Failed to fetch study overview' });
  }
});

/**
 * GET /api/dictionary/due -- Cards due for review + new cards
 */
router.get('/api/dictionary/due', authMiddleware, validate({ query: dueQuery }), async (req, res) => {
  try {
    const { rows } = await listDueWords(
      pool,
      req.userId,
      validTimeZone(req.query.timeZone),
      req.query.newLimitOverride ?? null,
    );
    return res.json(rows);
  } catch (err) {
    req.log.error({ err }, 'Error fetching due words');
    return res.status(500).json({ error: 'Failed to fetch due words' });
  }
});

/**
 * PATCH /api/dictionary/words/:id/review -- Record an Anki-style SRS review
 * Body: { answer: 'again' | 'good' }  (incorrect | correct)
 */
router.patch('/api/dictionary/words/:id/review', authMiddleware, validate({ params: uuidParam, body: reviewBody }), async (req, res) => {
  const { answer, timeZone } = req.body;

  try {
    const updated = await applySrsReview(pool, req.params.id, req.userId, answer, timeZone, {
      onAdvanceToNewStage: scheduleStageSentence,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Word not found' });
    }

    invalidateDictionaryCache(req.userId);
    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, 'Error reviewing word');
    return res.status(500).json({ error: 'Failed to record review' });
  }
});

/**
 * Fire-and-forget generator for the next per-stage example sentence. Called
 * by applySrsReview when a card just advanced to a new high stage (>= 4) for
 * the first time. Uses the request's pool for a fresh connection so the
 * review transaction is not blocked, and never throws to the caller.
 */
async function scheduleStageSentence({ db, card, newStage }) {
  // Resolve the user's languages — same query shape dictionary.js uses
  // elsewhere; cheaper than another join here.
  const { rows: langRows } = await db.query(
    'SELECT target_language, native_language FROM users WHERE id = $1',
    [card.user_id],
  );
  const targetLang = langRows[0]?.target_language || null;
  const nativeLang = langRows[0]?.native_language || 'en';

  const previousSentences = Array.isArray(card.stage_sentences)
    ? card.stage_sentences
    : [];

  const generated = await generateStageSentence({
    word: card.word,
    translation: card.translation,
    definition: card.definition,
    lemma: card.lemma,
    forms: card.forms,
    partOfSpeech: card.part_of_speech,
    targetLang,
    nativeLang,
    previousSentences,
  });

  // Append atomically. We re-read stage_sentences inside the UPDATE so a
  // concurrent race (two correct answers landing in the same second) cannot
  // clobber a sibling's append. JSONB || appends without a read-modify-write.
  const client = await db.connect();
  try {
    await client.query(
      `UPDATE saved_words
       SET stage_sentences = COALESCE(stage_sentences, '[]'::jsonb) || $1::jsonb
       WHERE id = $2 AND user_id = $3`,
      [
        JSON.stringify([
          { stage: newStage, example: generated.example, translation: generated.translation },
        ]),
        card.id,
        card.user_id,
      ],
    );
    logger.info({ cardId: card.id, stage: newStage }, 'stage-sentence generated');
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Saved Words CRUD
// ---------------------------------------------------------------------------

/**
 * GET /api/dictionary/words -- List all saved words for the authenticated user
 */
router.get('/api/dictionary/words', authMiddleware, validate({ query: savedWordsQuery }), async (req, res) => {
  try {
    const requestedLanguage = req.query.targetLanguage || null;
    const { rows } = await pool.query(
      `SELECT * FROM saved_words WHERE user_id = $1
         AND target_language = COALESCE($2, (SELECT target_language FROM users WHERE id = $1))
       ORDER BY created_at DESC`,
      [req.userId, requestedLanguage],
    );
    return res.json(rows);
  } catch (err) {
    req.log.error({ err }, 'Error fetching saved words');
    return res.status(500).json({ error: 'Failed to fetch saved words' });
  }
});

/**
 * GET /api/dictionary/word-groups -- Paginated grouped dictionary view
 */
router.get('/api/dictionary/word-groups', authMiddleware, validate({ query: wordsPageQuery }), async (req, res) => {
  try {
    const payload = await listDictionaryGroupPage(pool, req.userId, req.query);
    return res.json(payload);
  } catch (err) {
    req.log.error({ err }, 'Error fetching dictionary word groups');
    return res.status(500).json({ error: 'Failed to fetch dictionary groups' });
  }
});

/**
 * POST /api/dictionary/words -- Save a word to the personal dictionary
 */
router.post('/api/dictionary/words', authMiddleware, validate({ body: saveWordBody }), async (req, res) => {
  const { word, translation, definition, target_language, sentence_context, frequency, frequency_count, example_sentence, sentence_translation, part_of_speech, image_url, lemma, forms, surface_form, image_term } = req.body;

  // Guarantee the tapped surface form is among the stored inflections.
  const mergedForms = surface_form ? mergeForm(forms, surface_form) : (forms || null);

  try {
    // Check if this exact definition already exists
    const { rows: existing } = await pool.query(
      `SELECT * FROM saved_words
       WHERE user_id = $1 AND word = $2
         AND target_language IS NOT DISTINCT FROM $3
         AND definition = $4`,
      [req.userId, word, target_language || null, definition || ''],
    );
    if (existing.length > 0) {
      // Already saved — still ensure the tapped surface form is a stored form.
      const row = existing[0];
      if (surface_form) {
        const withForm = mergeForm(row.forms, surface_form);
        if (withForm !== row.forms) {
          const { rows: updatedRows } = await pool.query(
            'UPDATE saved_words SET forms = $3 WHERE id = $1 AND user_id = $2 RETURNING *',
            [row.id, req.userId, withForm],
          );
          invalidateDictionaryCache(req.userId);
          return res.status(200).json({ ...updatedRows[0], _created: false });
        }
      }
      return res.status(200).json({ ...row, _created: false });
    }

    // Insert new definition
    const { rows } = await pool.query(
      `INSERT INTO saved_words (user_id, word, translation, definition, target_language, sentence_context, frequency, example_sentence, sentence_translation, part_of_speech, image_url, lemma, forms, frequency_count, image_term)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [req.userId, word, translation || '', definition || '', target_language || null, sentence_context || null, frequency || null, example_sentence || null, sentence_translation || null, part_of_speech || null, image_url || null, lemma || null, mergedForms, frequency_count ?? null, image_term || null],
    );
    invalidateDictionaryCache(req.userId);
    return res.status(201).json({ ...rows[0], _created: true });
  } catch (err) {
    req.log.error({ err }, 'Error saving word');
    return res.status(500).json({ error: 'Failed to save word' });
  }
});

/**
 * PATCH /api/dictionary/words/:id -- Update editable fields on a saved word
 */
router.patch('/api/dictionary/words/:id', authMiddleware, validate({ params: uuidParam, body: updateWordBody }), async (req, res) => {
  const fields = ['word', 'translation', 'definition', 'example_sentence', 'sentence_translation', 'part_of_speech', 'image_url', 'image_term'];
  const sets = [];
  const values = [req.params.id, req.userId];
  let idx = 3;

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      sets.push(`${field} = $${idx}`);
      values.push(req.body[field]);
      idx++;
    }
  }

  if (sets.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE saved_words SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
      values,
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Word not found' });
    return res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, 'Error updating word');
    return res.status(500).json({ error: 'Failed to update word' });
  }
});

/**
 * POST /api/dictionary/words/:id/forms -- Append a surface form to a saved
 * word's inflection list (idempotent). Lets the reader "learn" an inflection
 * it encounters so every conjugation of an already-saved word highlights.
 */
router.post('/api/dictionary/words/:id/forms', authMiddleware, validate({ params: uuidParam, body: addFormBody }), async (req, res) => {
  try {
    const { rows: existing } = await pool.query(
      'SELECT forms FROM saved_words WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId],
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Word not found' });

    const merged = mergeForm(existing[0].forms, req.body.form);
    const { rows } = await pool.query(
      'UPDATE saved_words SET forms = $3 WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.userId, merged],
    );
    invalidateDictionaryCache(req.userId);
    return res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, 'Error adding word form');
    return res.status(500).json({ error: 'Failed to add word form' });
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
    invalidateDictionaryCache(req.userId);
    return res.status(204).end();
  } catch (err) {
    req.log.error({ err }, 'Error deleting saved word');
    return res.status(500).json({ error: 'Failed to delete word' });
  }
});

export default router;
