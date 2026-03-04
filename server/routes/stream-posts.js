import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, requireTeacher } from '../auth.js';
import pool from '../db.js';
import { enrichWord, fetchWordImage } from '../enrichWord.js';
import { validate } from '../lib/validate.js';

const router = Router();

const idParam = z.object({ id: z.string().uuid('Invalid post ID') });

const createPostBody = z.object({
  type: z.enum(['material', 'word_list', 'lesson', 'class_session'], { message: 'type must be material, word_list, lesson, or class_session' }),
  title: z.string().optional(),
  body: z.string().optional(),
  attachments: z.array(z.any()).optional(),
  words: z.array(z.any()).optional(),
  target_language: z.string().optional(),
  lesson_items: z.array(z.any()).optional(),
  topic_id: z.string().uuid().nullable().optional(),
  scheduled_at: z.string().optional(),
  duration_minutes: z.number().optional(),
  recurrence: z.any().optional(),
});

// ---------------------------------------------------------------------------
// enrichAndInsertWords — shared helper for POST + PATCH word list routes
// ---------------------------------------------------------------------------

async function enrichAndInsertWords(client, postId, words, nativeLang, targetLang) {
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

  // Deduplicate images: if multiple words got the same image_url, re-fetch alternatives
  const usedUrls = new Set();
  for (const w of enriched) {
    if (w.image_url && usedUrls.has(w.image_url)) {
      const alt = await fetchWordImage(w.image_term || w.word, usedUrls);
      w.image_url = alt;
    }
    if (w.image_url) usedUrls.add(w.image_url);
  }

  for (const w of enriched) {
    await client.query(
      `INSERT INTO stream_post_words
         (post_id, word, translation, definition, part_of_speech, position,
          frequency, frequency_count, example_sentence, image_url, lemma, forms, image_term)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        postId, w.word, w.translation, w.definition, w.part_of_speech, w.position,
        w.frequency ?? null, w.frequency_count ?? null, w.example_sentence ?? null,
        w.image_url ?? null, w.lemma ?? null, w.forms ?? null, w.image_term ?? null,
      ],
    );
  }
}

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
    req.log.error({ err }, 'GET /api/stream error');
    return res.status(500).json({ error: err.message || 'Failed to load stream' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream/pending — incomplete word lists for students
// ---------------------------------------------------------------------------

router.get('/api/stream/pending', authMiddleware, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      'SELECT account_type FROM users WHERE id = $1',
      [req.userId],
    );
    if (userRows.length === 0) return res.status(401).json({ error: 'User not found' });
    if (userRows[0].account_type === 'teacher') {
      return res.json({ count: 0, posts: [] });
    }

    const { rows } = await pool.query(
      `SELECT sp.id, sp.title, sp.created_at,
              COALESCE(wc.cnt, 0)::int AS word_count,
              COALESCE(u.display_name, u.username) AS teacher_name
       FROM stream_posts sp
       JOIN users u ON u.id = sp.teacher_id
       LEFT JOIN (
         SELECT post_id, COUNT(*) AS cnt FROM stream_post_words GROUP BY post_id
       ) wc ON wc.post_id = sp.id
       WHERE sp.type = 'word_list'
         AND sp.teacher_id IN (
           SELECT teacher_id FROM classroom_students WHERE student_id = $1
         )
         AND NOT EXISTS (
           SELECT 1 FROM stream_word_list_completions swlc
           WHERE swlc.post_id = sp.id AND swlc.student_id = $1
         )
       ORDER BY sp.created_at DESC`,
      [req.userId],
    );

    return res.json({ count: rows.length, posts: rows });
  } catch (err) {
    req.log.error({ err }, 'GET /api/stream/pending error');
    return res.status(500).json({ error: err.message || 'Failed to load pending classwork' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/posts — create a post (teacher only)
// ---------------------------------------------------------------------------

router.post('/api/stream/posts', authMiddleware, requireTeacher, validate({ body: createPostBody }), async (req, res) => {
  const { type, title, body, attachments, words, target_language, lesson_items, topic_id, scheduled_at, duration_minutes, recurrence } = req.body;

  try {
    const user = req.userRecord;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: postRows } = await client.query(
        `INSERT INTO stream_posts (teacher_id, type, title, body, attachments, target_language, lesson_items, topic_id, scheduled_at, duration_minutes, recurrence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
          scheduled_at || null,
          duration_minutes || null,
          recurrence ? JSON.stringify(recurrence) : null,
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

        await enrichAndInsertWords(client, post.id, words, nativeLang, targetLang);
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
    req.log.error({ err }, 'POST /api/stream/posts error');
    return res.status(500).json({ error: err.message || 'Failed to create post' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/stream/posts/:id — edit a post (teacher only, must own it)
// ---------------------------------------------------------------------------

router.patch('/api/stream/posts/:id', authMiddleware, validate({ params: idParam }), async (req, res) => {
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

        // Insert new words
        const { rows: userRows } = await client.query(
          'SELECT native_language FROM users WHERE id = $1', [req.userId],
        );
        const nativeLang = userRows[0]?.native_language;
        const targetLang = target_language || existing[0].target_language;

        await enrichAndInsertWords(client, req.params.id, words, nativeLang, targetLang);

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
    req.log.error({ err }, 'PATCH /api/stream/posts/:id error');
    return res.status(500).json({ error: err.message || 'Failed to update post' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/stream/posts/:id — delete a post (teacher only, must own it)
// ---------------------------------------------------------------------------

router.delete('/api/stream/posts/:id', authMiddleware, validate({ params: idParam }), async (req, res) => {
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
    req.log.error({ err }, 'DELETE /api/stream/posts/:id error');
    return res.status(500).json({ error: err.message || 'Failed to delete post' });
  }
});

export default router;
