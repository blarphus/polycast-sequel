import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, requireTeacher } from '../auth.js';
import pool from '../db.js';
import { enrichWord } from '../enrichWord.js';
import { callGemini } from '../lib/gemini.js';
import { fetchWordImage } from '../lib/imageSearch.js';
import { validate } from '../lib/validate.js';
import { ensureStudentHasLegacyPostAccess } from '../services/classroomService.js';
import { batchTranslateWordList, lookupWordsForPreview } from '../services/wordSemanticsService.js';

const router = Router();

const postIdParam = z.object({ postId: z.string().uuid('Invalid post ID') });
const idParam = z.object({ id: z.string().uuid('Invalid ID') });

const exampleBody = z.object({
  word: z.string().min(1, 'word is required'),
  targetLang: z.string().min(1, 'targetLang is required'),
  definition: z.string().optional(),
});

const batchTranslateBody = z.object({
  words: z.array(z.any()).min(1, 'words array is required'),
  nativeLang: z.string().min(1, 'nativeLang is required'),
  allWords: z.array(z.string()).optional(),
});

const lookupBody = z.object({
  words: z.array(z.any()).min(1, 'words array is required'),
  nativeLang: z.string().min(1, 'nativeLang is required'),
  targetLang: z.string().min(1, 'targetLang is required'),
});

const knownBody = z.object({
  postWordId: z.string().uuid('Invalid post word ID'),
  known: z.boolean(),
});

// ---------------------------------------------------------------------------
// POST /api/stream/words/example — generate a single example sentence (teacher)
// ---------------------------------------------------------------------------

router.post('/api/stream/words/example', authMiddleware, requireTeacher, validate({ body: exampleBody }), async (req, res) => {
  const { word, targetLang, definition } = req.body;

  try {
    const defHint = definition ? ` with the meaning "${definition}"` : '';
    const prompt = `Write a short example sentence in ${targetLang} using the word "${word}"${defHint}. Wrap the word with tildes like ~word~. 15 words max.

Return a JSON object: {"example_sentence":"..."}

Respond with ONLY the JSON object, no other text.`;

    const raw = await callGemini(prompt, { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 100, responseMimeType: 'application/json' });
    const parsed = JSON.parse(raw);
    return res.json({ example_sentence: parsed.example_sentence || null });
  } catch (err) {
    req.log.error({ err }, 'POST /api/stream/words/example error');
    return res.status(500).json({ error: err.message || 'Example sentence generation failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/words/batch-translate — translate pre-enriched template words
// ---------------------------------------------------------------------------

router.post('/api/stream/words/batch-translate', authMiddleware, requireTeacher, validate({ body: batchTranslateBody }), async (req, res) => {
  const { words, nativeLang, allWords } = req.body;

  try {
    const results = await batchTranslateWordList({ words, nativeLang, allWords });
    return res.json({ translations: results });
  } catch (err) {
    req.log.error({ err }, 'POST /api/stream/words/batch-translate error');
    return res.status(500).json({ error: err.message || 'Batch translation failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/words/lookup — preview word translations (teacher only)
// ---------------------------------------------------------------------------

router.post('/api/stream/words/lookup', authMiddleware, requireTeacher, validate({ body: lookupBody }), async (req, res) => {
  const { words, nativeLang, targetLang } = req.body;

  try {
    const previews = await lookupWordsForPreview(words, nativeLang, targetLang);
    return res.json({ words: previews });
  } catch (err) {
    req.log.error({ err }, 'POST /api/stream/words/lookup error');
    return res.status(500).json({ error: err.message || 'Word lookup failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream/posts/:id/enrich — SSE: enrich words that have no translation
// ---------------------------------------------------------------------------

router.get('/api/stream/posts/:id/enrich', authMiddleware, validate({ params: idParam }), async (req, res) => {
  const postId = req.params.id;

  const { rows } = await pool.query(
    'SELECT teacher_id, target_language FROM stream_posts WHERE id = $1',
    [postId],
  );
  if (!rows[0] || rows[0].teacher_id !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { rows: userRows } = await pool.query(
    'SELECT native_language FROM users WHERE id = $1', [req.userId],
  );
  const nativeLang = userRows[0]?.native_language;
  const targetLang = rows[0].target_language;

  const { rows: wordRows } = await pool.query(
    `SELECT id, word FROM stream_post_words
     WHERE post_id = $1 AND (translation IS NULL OR translation = '')
     ORDER BY position ASC`,
    [postId],
  );

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  for (const w of wordRows) {
    try {
      const result = await enrichWord(w.word, '', nativeLang, targetLang);
      await pool.query(
        `UPDATE stream_post_words
         SET translation=$1, definition=$2, part_of_speech=$3, frequency=$4,
             frequency_count=$5, example_sentence=$6, sentence_translation=$7,
             image_url=$8, lemma=$9, forms=$10, image_term=$11
         WHERE id=$12`,
        [result.translation, result.definition, result.part_of_speech,
         result.frequency, result.frequency_count, result.example_sentence,
         result.sentence_translation, result.image_url, result.lemma, result.forms,
         result.image_term, w.id],
      );
      res.write(`data: ${JSON.stringify({ word_id: w.id, ...result })}\n\n`);
    } catch (err) {
      req.log.error({ err }, 'enrichPostStream: failed to enrich word %s', w.id);
      res.write(`data: ${JSON.stringify({ word_id: w.id, error: true })}\n\n`);
    }
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

// ---------------------------------------------------------------------------
// POST /api/stream/posts/:postId/known — toggle known word (student)
// ---------------------------------------------------------------------------

router.post('/api/stream/posts/:postId/known', authMiddleware, validate({ params: postIdParam, body: knownBody }), async (req, res) => {
  const { postWordId, known } = req.body;

  try {
    const { rows: postExistsRows } = await pool.query(
      'SELECT 1 FROM stream_posts WHERE id = $1',
      [req.params.postId],
    );
    if (postExistsRows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const accessiblePost = await ensureStudentHasLegacyPostAccess(req.params.postId, req.userId);
    if (!accessiblePost) {
      return res.status(403).json({ error: 'Not enrolled in this classroom' });
    }

    if (known) {
      await pool.query(
        `INSERT INTO stream_word_known (student_id, post_word_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [req.userId, postWordId],
      );
    } else {
      await pool.query(
        'DELETE FROM stream_word_known WHERE student_id = $1 AND post_word_id = $2',
        [req.userId, postWordId],
      );
    }

    return res.status(204).end();
  } catch (err) {
    req.log.error({ err }, 'POST /api/stream/posts/:postId/known error');
    return res.status(500).json({ error: err.message || 'Failed to update known status' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/posts/:postId/add-to-dictionary — student adds unknown words
// ---------------------------------------------------------------------------

router.post('/api/stream/posts/:postId/add-to-dictionary', authMiddleware, validate({ params: postIdParam }), async (req, res) => {
  try {
    const { rows: postExistsRows } = await pool.query(
      'SELECT 1 FROM stream_posts WHERE id = $1',
      [req.params.postId],
    );
    if (postExistsRows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const accessiblePost = await ensureStudentHasLegacyPostAccess(req.params.postId, req.userId);
    if (!accessiblePost) {
      return res.status(403).json({ error: 'Not enrolled in this classroom' });
    }
    if (accessiblePost.type !== 'word_list') {
      return res.status(400).json({ error: 'Post is not a word list' });
    }

    const { rows: wordsToAdd } = await pool.query(
      `SELECT spw.*
       FROM stream_post_words spw
       WHERE spw.post_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM stream_word_known swk
           WHERE swk.post_word_id = spw.id AND swk.student_id = $2
         )`,
      [req.params.postId, req.userId],
    );

    const { rows: studentRows } = await pool.query(
      'SELECT target_language FROM users WHERE id = $1',
      [req.userId],
    );
    const targetLanguage = accessiblePost.target_language || studentRows[0]?.target_language || null;

    let added = 0;
    let skipped = 0;

    for (const w of wordsToAdd) {
      const imageUrl = w.image_url !== null ? w.image_url : await fetchWordImage(w.word);
      const { rowCount } = await pool.query(
        `INSERT INTO saved_words
           (user_id, word, translation, definition, target_language, part_of_speech,
            frequency, frequency_count, example_sentence, sentence_translation, image_url, lemma, forms, priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
         ON CONFLICT DO NOTHING`,
        [
          req.userId, w.word, w.translation, w.definition, targetLanguage, w.part_of_speech,
          w.frequency ?? null, w.frequency_count ?? null, w.example_sentence ?? null,
          w.sentence_translation ?? null, imageUrl, w.lemma ?? null, w.forms ?? null,
        ],
      );
      if (rowCount > 0) {
        added++;
      } else {
        skipped++;
      }
    }

    await pool.query(
      `INSERT INTO stream_word_list_completions (student_id, post_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.userId, req.params.postId],
    );

    return res.json({ added, skipped });
  } catch (err) {
    req.log.error({ err }, 'POST /api/stream/posts/:postId/add-to-dictionary error');
    return res.status(500).json({ error: err.message || 'Failed to add words to dictionary' });
  }
});

export default router;
