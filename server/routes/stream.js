import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';
import { enrichWord, fetchWordImage, callGemini } from '../enrichWord.js';
import { getEnglishFrequency, getEnglishFrequencyCount } from '../lib/englishFrequency.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/stream
// Teachers get their own posts + topics; students get posts + topics from teachers.
// ---------------------------------------------------------------------------

router.get('/api/stream', authMiddleware, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      'SELECT account_type FROM users WHERE id = $1',
      [req.userId],
    );
    if (userRows.length === 0) return res.status(401).json({ error: 'User not found' });
    const isTeacher = userRows[0].account_type === 'teacher';

    let posts;
    let topics;

    if (isTeacher) {
      const { rows: topicRows } = await pool.query(
        'SELECT * FROM stream_topics WHERE teacher_id = $1 ORDER BY position ASC',
        [req.userId],
      );
      topics = topicRows;

      const { rows } = await pool.query(
        `SELECT sp.*,
           COALESCE(wc.cnt, 0)::int AS word_count
         FROM stream_posts sp
         LEFT JOIN (
           SELECT post_id, COUNT(*) AS cnt FROM stream_post_words GROUP BY post_id
         ) wc ON wc.post_id = sp.id
         WHERE sp.teacher_id = $1
         ORDER BY sp.position ASC NULLS LAST, sp.created_at DESC`,
        [req.userId],
      );
      posts = rows;
    } else {
      const { rows: topicRows } = await pool.query(
        `SELECT st.*, COALESCE(u.display_name, u.username) AS teacher_name
         FROM stream_topics st
         JOIN users u ON u.id = st.teacher_id
         WHERE st.teacher_id IN (SELECT teacher_id FROM classroom_students WHERE student_id = $1)
         ORDER BY st.position ASC`,
        [req.userId],
      );
      topics = topicRows;

      const { rows } = await pool.query(
        `SELECT sp.*,
           COALESCE(wc.cnt, 0)::int AS word_count,
           u.display_name AS teacher_display_name,
           u.username AS teacher_username
         FROM stream_posts sp
         JOIN users u ON u.id = sp.teacher_id
         LEFT JOIN (
           SELECT post_id, COUNT(*) AS cnt FROM stream_post_words GROUP BY post_id
         ) wc ON wc.post_id = sp.id
         WHERE sp.teacher_id IN (
           SELECT teacher_id FROM classroom_students WHERE student_id = $1
         )
         ORDER BY sp.position ASC NULLS LAST, sp.created_at DESC`,
        [req.userId],
      );
      posts = rows.map((p) => ({
        ...p,
        teacher_name: p.teacher_display_name || p.teacher_username,
      }));
    }

    // Fetch words for all word_list posts in one query
    const wordListPostIds = posts.filter((p) => p.type === 'word_list').map((p) => p.id);
    let wordsByPostId = {};
    if (wordListPostIds.length > 0) {
      const { rows: wordRows } = await pool.query(
        `SELECT * FROM stream_post_words
         WHERE post_id = ANY($1)
         ORDER BY position ASC NULLS LAST, created_at ASC`,
        [wordListPostIds],
      );
      for (const w of wordRows) {
        if (!wordsByPostId[w.post_id]) wordsByPostId[w.post_id] = [];
        wordsByPostId[w.post_id].push(w);
      }
    }

    // For students: fetch known_word_ids and completed status
    let knownWordsByPostId = {};
    let completedPostIds = new Set();

    if (!isTeacher && wordListPostIds.length > 0) {
      const allWordIds = Object.values(wordsByPostId).flat().map((w) => w.id);
      if (allWordIds.length > 0) {
        const { rows: knownRows } = await pool.query(
          `SELECT post_word_id FROM stream_word_known
           WHERE student_id = $1 AND post_word_id = ANY($2)`,
          [req.userId, allWordIds],
        );
        const wordIdToPostId = {};
        for (const [postId, words] of Object.entries(wordsByPostId)) {
          for (const w of words) wordIdToPostId[w.id] = postId;
        }
        for (const row of knownRows) {
          const postId = wordIdToPostId[row.post_word_id];
          if (!knownWordsByPostId[postId]) knownWordsByPostId[postId] = [];
          knownWordsByPostId[postId].push(row.post_word_id);
        }
      }

      const { rows: completionRows } = await pool.query(
        `SELECT post_id FROM stream_word_list_completions
         WHERE student_id = $1 AND post_id = ANY($2)`,
        [req.userId, wordListPostIds],
      );
      for (const row of completionRows) completedPostIds.add(row.post_id);
    }

    const assembled = posts.map((p) => {
      const post = { ...p };
      if (p.type === 'word_list') {
        post.words = wordsByPostId[p.id] || [];
        if (!isTeacher) {
          post.known_word_ids = knownWordsByPostId[p.id] || [];
          post.completed = completedPostIds.has(p.id);
        }
      }
      return post;
    });

    return res.json({ topics, posts: assembled });
  } catch (err) {
    console.error('GET /api/stream error:', err);
    return res.status(500).json({ error: err.message || 'Failed to load stream' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/topics — create a topic (teacher only)
// ---------------------------------------------------------------------------

router.post('/api/stream/topics', authMiddleware, async (req, res) => {
  const { title } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });

  try {
    const { rows: userRows } = await pool.query(
      'SELECT account_type FROM users WHERE id = $1',
      [req.userId],
    );
    if (userRows[0]?.account_type !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can create topics' });
    }

    const { rows: maxRows } = await pool.query(
      'SELECT COALESCE(MAX(position), -1) AS max_pos FROM stream_topics WHERE teacher_id = $1',
      [req.userId],
    );
    const nextPos = (maxRows[0].max_pos ?? -1) + 1;

    const { rows } = await pool.query(
      `INSERT INTO stream_topics (teacher_id, title, position)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.userId, title.trim(), nextPos],
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /api/stream/topics error:', err);
    return res.status(500).json({ error: err.message || 'Failed to create topic' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/stream/topics/:id — rename a topic (teacher only, must own it)
// ---------------------------------------------------------------------------

router.patch('/api/stream/topics/:id', authMiddleware, async (req, res) => {
  const { title } = req.body;
  try {
    const { rows: existing } = await pool.query(
      'SELECT * FROM stream_topics WHERE id = $1',
      [req.params.id],
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Topic not found' });
    if (existing[0].teacher_id !== req.userId) {
      return res.status(403).json({ error: 'Not your topic' });
    }

    const { rows } = await pool.query(
      `UPDATE stream_topics SET title = COALESCE($1, title) WHERE id = $2 RETURNING *`,
      [title !== undefined ? title.trim() : null, req.params.id],
    );
    return res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /api/stream/topics/:id error:', err);
    return res.status(500).json({ error: err.message || 'Failed to update topic' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/stream/topics/:id — delete a topic; posts get topic_id = NULL
// ---------------------------------------------------------------------------

router.delete('/api/stream/topics/:id', authMiddleware, async (req, res) => {
  try {
    const { rows: existing } = await pool.query(
      'SELECT teacher_id FROM stream_topics WHERE id = $1',
      [req.params.id],
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Topic not found' });
    if (existing[0].teacher_id !== req.userId) {
      return res.status(403).json({ error: 'Not your topic' });
    }

    await pool.query('DELETE FROM stream_topics WHERE id = $1', [req.params.id]);
    return res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/stream/topics/:id error:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete topic' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/stream/reorder — bulk reorder posts and/or topics (teacher only)
// ---------------------------------------------------------------------------

router.patch('/api/stream/reorder', authMiddleware, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }

  try {
    const { rows: userRows } = await pool.query(
      'SELECT account_type FROM users WHERE id = $1',
      [req.userId],
    );
    if (userRows[0]?.account_type !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can reorder' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const item of items) {
        if (item.kind === 'post') {
          const { rows } = await client.query(
            'SELECT teacher_id FROM stream_posts WHERE id = $1',
            [item.id],
          );
          if (rows.length === 0 || rows[0].teacher_id !== req.userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Not your post: ' + item.id });
          }
          await client.query(
            `UPDATE stream_posts SET position = $1, topic_id = $2, updated_at = NOW() WHERE id = $3`,
            [item.position, item.topic_id !== undefined ? item.topic_id : null, item.id],
          );
        } else if (item.kind === 'topic') {
          const { rows } = await client.query(
            'SELECT teacher_id FROM stream_topics WHERE id = $1',
            [item.id],
          );
          if (rows.length === 0 || rows[0].teacher_id !== req.userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Not your topic: ' + item.id });
          }
          await client.query(
            `UPDATE stream_topics SET position = $1 WHERE id = $2`,
            [item.position, item.id],
          );
        }
      }

      await client.query('COMMIT');
      return res.status(204).end();
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('PATCH /api/stream/reorder error:', err);
    return res.status(500).json({ error: err.message || 'Failed to reorder' });
  }
});

// ---------------------------------------------------------------------------
// lookupWordForPost — quick translation/definition preview for word list creation
// ---------------------------------------------------------------------------

async function lookupWordForPost(word, nativeLang, targetLang) {
  const prompt = `Translate and define the ${targetLang || 'foreign'} word "${word}". The user's native language is ${nativeLang}.

Return a JSON object with exactly these keys:
{"translation":"...","definition":"...","part_of_speech":"...","example_sentence":"...","frequency":0,"lemma":"...","forms":"...","image_term":"..."}

- translation: standard ${nativeLang} translation of "${word}", 1-3 words max
- definition: what this word means in ${nativeLang}, 12 words max, no markdown
- part_of_speech: one of noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle
- example_sentence: a short sentence in ${targetLang} using "${word}", wrap the word with tildes like ~word~, 15 words max
- frequency: integer 1-10 how common this word is (1-2 rare, 3-4 uncommon, 5-6 moderate, 7-8 common everyday, 9-10 essential top-500)
- lemma: dictionary/base form (infinitive for verbs, singular for nouns). Same as word if already base form. Empty string for particles/prepositions.
- forms: comma-separated inflected forms of the lemma (e.g. "run, runs, ran, running"). Empty string if uninflected.
- image_term: a 1-4 word English phrase describing a concrete, photographable subject that captures THIS SPECIFIC meaning of the word. Works as a stock-photo search query. Concrete nouns → the object itself. Abstract words → a vivid scene or tangible symbol. Do NOT repeat the word itself unless it is already a concrete noun.

Respond with ONLY the JSON object, no other text.`;

  const raw = await callGemini(prompt, { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 400, responseMimeType: 'application/json' });
  const parsed = JSON.parse(raw);
  const image_url = await fetchWordImage(parsed.image_term || word);

  let frequency = typeof parsed.frequency === 'number' ? parsed.frequency : null;
  let frequency_count = null;

  // For English words, override with corpus data
  if (targetLang === 'en' || targetLang?.startsWith('en-')) {
    const corpusFreq = getEnglishFrequency(word);
    if (corpusFreq !== null) frequency = corpusFreq;
    frequency_count = getEnglishFrequencyCount(word);
  }

  // Normalize forms
  let forms = null;
  if (parsed.forms) {
    const formsList = parsed.forms.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (formsList.length > 1) forms = JSON.stringify(formsList);
  }

  // Normalize lemma
  let lemma = parsed.lemma?.trim() || null;
  if (lemma && parsed.part_of_speech === 'verb' && (targetLang === 'en' || targetLang?.startsWith('en-'))) {
    if (!lemma.startsWith('to ')) lemma = 'to ' + lemma;
  }

  return {
    translation: parsed.translation || '',
    definition: parsed.definition || '',
    part_of_speech: parsed.part_of_speech || null,
    example_sentence: parsed.example_sentence || null,
    image_url,
    frequency,
    frequency_count,
    lemma,
    forms,
    image_term: parsed.image_term || word,
  };
}

// ---------------------------------------------------------------------------
// POST /api/stream/words/example — generate a single example sentence (teacher)
// ---------------------------------------------------------------------------

router.post('/api/stream/words/example', authMiddleware, async (req, res) => {
  const { word, targetLang, definition } = req.body;
  if (!word) return res.status(400).json({ error: 'word is required' });
  if (!targetLang) return res.status(400).json({ error: 'targetLang is required' });

  try {
    const { rows: userRows } = await pool.query(
      'SELECT account_type FROM users WHERE id = $1',
      [req.userId],
    );
    if (userRows[0]?.account_type !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can generate example sentences' });
    }

    const defHint = definition ? ` with the meaning "${definition}"` : '';
    const prompt = `Write a short example sentence in ${targetLang} using the word "${word}"${defHint}. Wrap the word with tildes like ~word~. 15 words max.

Return a JSON object: {"example_sentence":"..."}

Respond with ONLY the JSON object, no other text.`;

    const raw = await callGemini(prompt, { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 100, responseMimeType: 'application/json' });
    const parsed = JSON.parse(raw);
    return res.json({ example_sentence: parsed.example_sentence || null });
  } catch (err) {
    console.error('POST /api/stream/words/example error:', err);
    return res.status(500).json({ error: err.message || 'Example sentence generation failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/words/lookup — preview word translations (teacher only)
// ---------------------------------------------------------------------------

router.post('/api/stream/words/lookup', authMiddleware, async (req, res) => {
  const { words, nativeLang, targetLang } = req.body;

  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'words array is required' });
  }
  if (!nativeLang) return res.status(400).json({ error: 'nativeLang is required' });
  if (!targetLang) return res.status(400).json({ error: 'targetLang is required' });

  try {
    const { rows: userRows } = await pool.query(
      'SELECT account_type FROM users WHERE id = $1',
      [req.userId],
    );
    if (userRows[0]?.account_type !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can look up words' });
    }

    const results = await Promise.all(
      words.map(async (word, i) => {
        const enriched = await lookupWordForPost(word.trim(), nativeLang, targetLang);
        return { id: `preview-${i}`, word: word.trim(), position: i, ...enriched };
      }),
    );

    return res.json({ words: results });
  } catch (err) {
    console.error('POST /api/stream/words/lookup error:', err);
    return res.status(500).json({ error: err.message || 'Word lookup failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/posts — create a post (teacher only)
// ---------------------------------------------------------------------------

router.post('/api/stream/posts', authMiddleware, async (req, res) => {
  const { type, title, body, attachments, words, target_language, lesson_items, topic_id } = req.body;

  if (!type || !['material', 'word_list', 'lesson'].includes(type)) {
    return res.status(400).json({ error: 'type must be material, word_list, or lesson' });
  }

  try {
    const { rows: userRows } = await pool.query(
      'SELECT account_type, native_language, target_language FROM users WHERE id = $1',
      [req.userId],
    );
    const user = userRows[0];
    if (!user || user.account_type !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can create posts' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: postRows } = await client.query(
        `INSERT INTO stream_posts (teacher_id, type, title, body, attachments, target_language, lesson_items, topic_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          req.userId,
          type,
          title || null,
          body || null,
          JSON.stringify(attachments || []),
          target_language || user.target_language || null,
          JSON.stringify(lesson_items || []),
          topic_id || null,
        ],
      );
      const post = postRows[0];

      if (type === 'word_list' && Array.isArray(words) && words.length > 0) {
        const nativeLang = user.native_language;
        const targetLang = target_language || user.target_language;

        if (!nativeLang) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Teacher must set native_language in settings before creating word lists' });
        }

        const enriched = await Promise.all(
          words.map(async (word, i) => {
            const wordStr = typeof word === 'string' ? word.trim() : word.word;
            if (typeof word === 'object' && word.translation) {
              // Already enriched from lookup — use preview data directly
              return {
                word: wordStr, position: i,
                translation: word.translation,
                definition: word.definition ?? '',
                part_of_speech: word.part_of_speech ?? null,
                frequency: word.frequency ?? null,
                frequency_count: word.frequency_count ?? null,
                example_sentence: word.example_sentence ?? null,
                image_url: word.image_url ?? null,
                lemma: word.lemma ?? null,
                forms: word.forms ?? null,
                image_term: word.image_term ?? null,
              };
            }
            // No preview data — enrich now (posted without lookup)
            const result = await enrichWord(wordStr, '', nativeLang, targetLang);
            if (typeof word === 'object') {
              if (word.image_url !== undefined) result.image_url = word.image_url;
              if (word.definition !== undefined) result.definition = word.definition;
              if (word.example_sentence !== undefined) result.example_sentence = word.example_sentence;
            }
            return { word: wordStr, position: i, ...result };
          }),
        );

        for (const w of enriched) {
          await client.query(
            `INSERT INTO stream_post_words
               (post_id, word, translation, definition, part_of_speech, position,
                frequency, frequency_count, example_sentence, image_url, lemma, forms, image_term)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              post.id, w.word, w.translation, w.definition, w.part_of_speech, w.position,
              w.frequency ?? null, w.frequency_count ?? null, w.example_sentence ?? null,
              w.image_url ?? null, w.lemma ?? null, w.forms ?? null, w.image_term ?? null,
            ],
          );
        }
      }

      await client.query('COMMIT');

      const { rows: wordRows } = await pool.query(
        'SELECT * FROM stream_post_words WHERE post_id = $1 ORDER BY position ASC',
        [post.id],
      );

      return res.status(201).json({ ...post, words: wordRows });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('POST /api/stream/posts error:', err);
    return res.status(500).json({ error: err.message || 'Failed to create post' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream/posts/:id/enrich — SSE: enrich words that have no translation
// ---------------------------------------------------------------------------

router.get('/api/stream/posts/:id/enrich', authMiddleware, async (req, res) => {
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
             frequency_count=$5, example_sentence=$6, image_url=$7, lemma=$8, forms=$9,
             image_term=$10
         WHERE id=$11`,
        [result.translation, result.definition, result.part_of_speech,
         result.frequency, result.frequency_count, result.example_sentence,
         result.image_url, result.lemma, result.forms, result.image_term, w.id],
      );
      res.write(`data: ${JSON.stringify({ word_id: w.id, ...result })}\n\n`);
    } catch (err) {
      console.error(`enrichPostStream: failed to enrich word ${w.id}:`, err);
      res.write(`data: ${JSON.stringify({ word_id: w.id, error: true })}\n\n`);
    }
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

// ---------------------------------------------------------------------------
// PATCH /api/stream/posts/:id — edit a post (teacher only, must own it)
// ---------------------------------------------------------------------------

router.patch('/api/stream/posts/:id', authMiddleware, async (req, res) => {
  const { title, body, attachments, lesson_items, words, target_language } = req.body;
  const topicIdInBody = Object.prototype.hasOwnProperty.call(req.body, 'topic_id');
  const topicId = req.body.topic_id;

  try {
    const { rows: existing } = await pool.query(
      'SELECT * FROM stream_posts WHERE id = $1',
      [req.params.id],
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Post not found' });
    if (existing[0].teacher_id !== req.userId) {
      return res.status(403).json({ error: 'Not your post' });
    }

    // --- Word list edit: delete old words + re-insert in a transaction ---
    if (Array.isArray(words) && existing[0].type === 'word_list') {
      if (words.length === 0) {
        return res.status(400).json({ error: 'Word list must have at least one word' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Update post row (title + target_language + topic)
        const updateParams = [
          title !== undefined ? title : existing[0].title,
          target_language !== undefined ? target_language : existing[0].target_language,
        ];
        let updateQuery = `UPDATE stream_posts
           SET title = $1, target_language = $2, updated_at = NOW()`;
        if (topicIdInBody) {
          updateParams.push(topicId);
          updateQuery += `, topic_id = $${updateParams.length}`;
        }
        updateParams.push(req.params.id);
        updateQuery += ` WHERE id = $${updateParams.length} RETURNING *`;
        const { rows: postRows } = await client.query(updateQuery, updateParams);
        const post = postRows[0];

        // Reset student completions (word list changed)
        await client.query(
          'DELETE FROM stream_word_list_completions WHERE post_id = $1',
          [req.params.id],
        );

        // Delete old words (cascades to stream_word_known)
        await client.query(
          'DELETE FROM stream_post_words WHERE post_id = $1',
          [req.params.id],
        );

        // Insert new words (same pattern as POST creation)
        const { rows: userRows } = await client.query(
          'SELECT native_language FROM users WHERE id = $1', [req.userId],
        );
        const nativeLang = userRows[0]?.native_language;
        const targetLang = target_language || existing[0].target_language;

        const enriched = await Promise.all(
          words.map(async (word, i) => {
            const wordStr = typeof word === 'string' ? word.trim() : word.word;
            if (typeof word === 'object' && word.translation) {
              return {
                word: wordStr, position: i,
                translation: word.translation,
                definition: word.definition ?? '',
                part_of_speech: word.part_of_speech ?? null,
                frequency: word.frequency ?? null,
                frequency_count: word.frequency_count ?? null,
                example_sentence: word.example_sentence ?? null,
                image_url: word.image_url ?? null,
                lemma: word.lemma ?? null,
                forms: word.forms ?? null,
                image_term: word.image_term ?? null,
              };
            }
            const result = await enrichWord(wordStr, '', nativeLang, targetLang);
            if (typeof word === 'object') {
              if (word.image_url !== undefined) result.image_url = word.image_url;
              if (word.definition !== undefined) result.definition = word.definition;
              if (word.example_sentence !== undefined) result.example_sentence = word.example_sentence;
            }
            return { word: wordStr, position: i, ...result };
          }),
        );

        for (const w of enriched) {
          await client.query(
            `INSERT INTO stream_post_words
               (post_id, word, translation, definition, part_of_speech, position,
                frequency, frequency_count, example_sentence, image_url, lemma, forms, image_term)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              req.params.id, w.word, w.translation, w.definition, w.part_of_speech, w.position,
              w.frequency ?? null, w.frequency_count ?? null, w.example_sentence ?? null,
              w.image_url ?? null, w.lemma ?? null, w.forms ?? null, w.image_term ?? null,
            ],
          );
        }

        await client.query('COMMIT');

        const { rows: wordRows } = await pool.query(
          'SELECT * FROM stream_post_words WHERE post_id = $1 ORDER BY position ASC',
          [req.params.id],
        );

        return res.json({ ...post, words: wordRows, word_count: wordRows.length });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // --- Standard (non-word-list) update ---
    const params = [
      title !== undefined ? title : null,
      body !== undefined ? body : null,
      attachments !== undefined ? JSON.stringify(attachments) : null,
      lesson_items !== undefined ? JSON.stringify(lesson_items) : null,
    ];

    let query = `UPDATE stream_posts
       SET title = COALESCE($1, title),
           body = COALESCE($2, body),
           attachments = COALESCE($3, attachments),
           lesson_items = COALESCE($4, lesson_items),
           updated_at = NOW()`;

    if (target_language !== undefined) {
      params.push(target_language);
      query += `, target_language = $${params.length}`;
    }

    if (topicIdInBody) {
      params.push(topicId);
      query += `, topic_id = $${params.length}`;
    }

    params.push(req.params.id);
    query += ` WHERE id = $${params.length} RETURNING *`;

    const { rows } = await pool.query(query, params);
    return res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /api/stream/posts/:id error:', err);
    return res.status(500).json({ error: err.message || 'Failed to update post' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/stream/posts/:id — delete a post (teacher only, must own it)
// ---------------------------------------------------------------------------

router.delete('/api/stream/posts/:id', authMiddleware, async (req, res) => {
  try {
    const { rows: existing } = await pool.query(
      'SELECT teacher_id FROM stream_posts WHERE id = $1',
      [req.params.id],
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Post not found' });
    if (existing[0].teacher_id !== req.userId) {
      return res.status(403).json({ error: 'Not your post' });
    }

    await pool.query('DELETE FROM stream_posts WHERE id = $1', [req.params.id]);
    return res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/stream/posts/:id error:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete post' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/posts/:postId/known — toggle known word (student)
// ---------------------------------------------------------------------------

router.post('/api/stream/posts/:postId/known', authMiddleware, async (req, res) => {
  const { postWordId, known } = req.body;

  if (!postWordId || known === undefined) {
    return res.status(400).json({ error: 'postWordId and known are required' });
  }

  try {
    const { rows: postRows } = await pool.query(
      'SELECT teacher_id FROM stream_posts WHERE id = $1',
      [req.params.postId],
    );
    if (postRows.length === 0) return res.status(404).json({ error: 'Post not found' });

    const { rows: enrollRows } = await pool.query(
      'SELECT 1 FROM classroom_students WHERE teacher_id = $1 AND student_id = $2',
      [postRows[0].teacher_id, req.userId],
    );
    if (enrollRows.length === 0) {
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
    console.error('POST /api/stream/posts/:postId/known error:', err);
    return res.status(500).json({ error: err.message || 'Failed to update known status' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/posts/:postId/add-to-dictionary — student adds unknown words
// ---------------------------------------------------------------------------

router.post('/api/stream/posts/:postId/add-to-dictionary', authMiddleware, async (req, res) => {
  try {
    const { rows: postRows } = await pool.query(
      'SELECT * FROM stream_posts WHERE id = $1',
      [req.params.postId],
    );
    if (postRows.length === 0) return res.status(404).json({ error: 'Post not found' });
    if (postRows[0].type !== 'word_list') {
      return res.status(400).json({ error: 'Post is not a word list' });
    }

    const { rows: enrollRows } = await pool.query(
      'SELECT 1 FROM classroom_students WHERE teacher_id = $1 AND student_id = $2',
      [postRows[0].teacher_id, req.userId],
    );
    if (enrollRows.length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this classroom' });
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
    const targetLanguage = postRows[0].target_language || studentRows[0]?.target_language || null;

    let added = 0;
    let skipped = 0;

    for (const w of wordsToAdd) {
      const imageUrl = w.image_url !== null ? w.image_url : await fetchWordImage(w.word);
      const { rowCount } = await pool.query(
        `INSERT INTO saved_words
           (user_id, word, translation, definition, target_language, part_of_speech,
            frequency, frequency_count, example_sentence, image_url, lemma, forms, priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
         ON CONFLICT DO NOTHING`,
        [
          req.userId, w.word, w.translation, w.definition, targetLanguage, w.part_of_speech,
          w.frequency ?? null, w.frequency_count ?? null, w.example_sentence ?? null,
          imageUrl, w.lemma ?? null, w.forms ?? null,
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
    console.error('POST /api/stream/posts/:postId/add-to-dictionary error:', err);
    return res.status(500).json({ error: err.message || 'Failed to add words to dictionary' });
  }
});

export default router;
