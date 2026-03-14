import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, requireTeacher } from '../auth.js';
import pool from '../db.js';
import { validate } from '../lib/validate.js';
import { getUserAccountType } from '../lib/userQueries.js';
import { enrichAndInsertWords } from '../services/streamWordService.js';
import {
  getClassroomTopics,
  getLegacyStreamContext,
  listLegacyTeacherIdsForStudent,
} from '../services/classroomService.js';
import { WORD_COUNT_JOIN, COMPLETION_COUNT_JOIN } from '../lib/streamPostQueries.js';

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
const streamQuery = z.object({
  classroomId: z.string().uuid('Invalid classroom ID').optional(),
});

async function findOwnedPost(req, res) {
  const { rows } = await pool.query(
    'SELECT * FROM stream_posts WHERE id = $1',
    [req.params.id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'Post not found' });
    return null;
  }
  if (rows[0].teacher_id !== req.userId) {
    res.status(403).json({ error: 'Not your post' });
    return null;
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// GET /api/stream
// Teachers get their own posts + topics; students get posts + topics from teachers.
// ---------------------------------------------------------------------------

router.get('/api/stream', authMiddleware, validate({ query: streamQuery }), async (req, res) => {
  try {
    const accountType = await getUserAccountType(req.userId);
    if (!accountType) return res.status(401).json({ error: 'User not found' });
    const isTeacher = accountType === 'teacher';
    const classroomId = req.query.classroomId;
    const classroomContext = classroomId
      ? await getLegacyStreamContext(classroomId, req.userId)
      : null;

    if (classroomContext && !classroomContext.legacyTeacherId) {
      const topics = await getClassroomTopics(classroomId);
      return res.json({ topics, posts: [] });
    }

    let posts;
    let topics;
    const legacyTeacherId = classroomContext?.legacyTeacherId || null;

    if (isTeacher) {
      const { rows: topicRows } = await pool.query(
        'SELECT * FROM stream_topics WHERE teacher_id = $1 ORDER BY position ASC',
        [legacyTeacherId || req.userId],
      );
      topics = topicRows;

      const { rows } = await pool.query(
        `SELECT sp.*,
           COALESCE(wc.cnt, 0)::int AS word_count,
           COALESCE(comp.cnt, 0)::int AS completed_count
         FROM stream_posts sp
         ${WORD_COUNT_JOIN}
         ${COMPLETION_COUNT_JOIN}
         WHERE sp.teacher_id = $1
         ORDER BY sp.position ASC NULLS LAST, sp.created_at DESC`,
        [legacyTeacherId || req.userId],
      );
      posts = rows;
    } else {
      if (legacyTeacherId) {
        const { rows: topicRows } = await pool.query(
          `SELECT st.*, COALESCE(u.display_name, u.username) AS teacher_name
           FROM stream_topics st
           JOIN users u ON u.id = st.teacher_id
           WHERE st.teacher_id = $1
           ORDER BY st.position ASC`,
          [legacyTeacherId],
        );
        topics = topicRows;

        const { rows } = await pool.query(
          `SELECT sp.*,
             COALESCE(wc.cnt, 0)::int AS word_count,
             u.display_name AS teacher_display_name,
             u.username AS teacher_username
           FROM stream_posts sp
           JOIN users u ON u.id = sp.teacher_id
           ${WORD_COUNT_JOIN}
           WHERE sp.teacher_id = $1
           ORDER BY sp.position ASC NULLS LAST, sp.created_at DESC`,
          [legacyTeacherId],
        );
        posts = rows.map((p) => ({
          ...p,
          teacher_name: p.teacher_display_name || p.teacher_username,
        }));
      } else {
        const visibleTeacherIds = await listLegacyTeacherIdsForStudent(req.userId);
        if (visibleTeacherIds.length === 0) {
          return res.json({ topics: [], posts: [] });
        }

        const { rows: topicRows } = await pool.query(
          `SELECT st.*, COALESCE(u.display_name, u.username) AS teacher_name
           FROM stream_topics st
           JOIN users u ON u.id = st.teacher_id
           WHERE st.teacher_id = ANY($1::uuid[])
           ORDER BY st.position ASC`,
          [visibleTeacherIds],
        );
        topics = topicRows;

        const { rows } = await pool.query(
          `SELECT sp.*,
             COALESCE(wc.cnt, 0)::int AS word_count,
             u.display_name AS teacher_display_name,
             u.username AS teacher_username
           FROM stream_posts sp
           JOIN users u ON u.id = sp.teacher_id
           ${WORD_COUNT_JOIN}
           WHERE sp.teacher_id = ANY($1::uuid[])
           ORDER BY sp.position ASC NULLS LAST, sp.created_at DESC`,
          [visibleTeacherIds],
        );
        posts = rows.map((p) => ({
          ...p,
          teacher_name: p.teacher_display_name || p.teacher_username,
        }));
      }
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

    const result = { topics, posts: assembled };

    if (isTeacher && classroomId) {
      const { rows: scRows } = await pool.query(
        `SELECT COUNT(*)::int AS student_count FROM classroom_enrollments WHERE classroom_id = $1`,
        [classroomId],
      );
      result.student_count = scRows[0]?.student_count || 0;
    }

    return res.json(result);
  } catch (err) {
    req.log.error({ err }, 'GET /api/stream error');
    return res.status(500).json({ error: err.message || 'Failed to load stream' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream/posts/:id/completions — per-student completion detail (teacher)
// ---------------------------------------------------------------------------

router.get('/api/stream/posts/:id/completions', authMiddleware, validate({ params: idParam }), async (req, res) => {
  try {
    const post = await findOwnedPost(req, res);
    if (!post) return;

    // Find the classroom for this teacher (default-migrated)
    const { rows: classroomRows } = await pool.query(
      `SELECT ct.classroom_id
       FROM classroom_teachers ct
       JOIN classrooms c ON c.id = ct.classroom_id
       WHERE ct.teacher_id = $1 AND c.is_default_migrated = true AND c.archived_at IS NULL
       LIMIT 1`,
      [req.userId],
    );
    if (classroomRows.length === 0) {
      return res.json({ total: 0, completed: 0, students: [] });
    }
    const classroomId = classroomRows[0].classroom_id;

    const { rows: students } = await pool.query(
      `SELECT u.id, u.username, u.display_name,
              swlc.completed_at IS NOT NULL AS completed,
              swlc.completed_at
       FROM classroom_enrollments ce
       JOIN users u ON u.id = ce.student_id
       LEFT JOIN stream_word_list_completions swlc
         ON swlc.post_id = $1 AND swlc.student_id = ce.student_id
       WHERE ce.classroom_id = $2
       ORDER BY swlc.completed_at IS NOT NULL ASC, u.username ASC`,
      [req.params.id, classroomId],
    );

    const completedCount = students.filter((s) => s.completed).length;

    return res.json({
      total: students.length,
      completed: completedCount,
      students: students.map((s) => ({
        id: s.id,
        username: s.username,
        display_name: s.display_name,
        completed: s.completed,
        completed_at: s.completed_at,
      })),
    });
  } catch (err) {
    req.log.error({ err }, 'GET /api/stream/posts/:id/completions error');
    return res.status(500).json({ error: err.message || 'Failed to load completions' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream/pending — incomplete word lists for students
// ---------------------------------------------------------------------------

router.get('/api/stream/pending', authMiddleware, async (req, res) => {
  try {
    const accountType = await getUserAccountType(req.userId);
    if (!accountType) return res.status(401).json({ error: 'User not found' });
    if (accountType === 'teacher') {
      return res.json({ count: 0, posts: [] });
    }

    const visibleTeacherIds = await listLegacyTeacherIdsForStudent(req.userId);
    if (visibleTeacherIds.length === 0) {
      return res.json({ count: 0, posts: [] });
    }

    const { rows } = await pool.query(
      `SELECT sp.id, sp.title, sp.created_at,
              COALESCE(wc.cnt, 0)::int AS word_count,
              COALESCE(u.display_name, u.username) AS teacher_name
           FROM stream_posts sp
           JOIN users u ON u.id = sp.teacher_id
           ${WORD_COUNT_JOIN}
           WHERE sp.type = 'word_list'
             AND sp.teacher_id = ANY($2::uuid[])
            AND NOT EXISTS (
              SELECT 1 FROM stream_word_list_completions swlc
              WHERE swlc.post_id = sp.id AND swlc.student_id = $1
         )
       ORDER BY sp.created_at DESC`,
      [req.userId, visibleTeacherIds],
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
    const existing = await findOwnedPost(req, res);
    if (!existing) return;

    // --- Word list edit: delete old words + re-insert in a transaction ---
    if (Array.isArray(words) && existing.type === 'word_list') {
      if (words.length === 0) {
        return res.status(400).json({ error: 'Word list must have at least one word' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Update post row (title + target_language + topic)
        const updateParams = [
          title !== undefined ? title : existing.title,
          target_language !== undefined ? target_language : existing.target_language,
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
        const targetLang = target_language || existing.target_language;

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
    const post = await findOwnedPost(req, res);
    if (!post) return;

    await pool.query('DELETE FROM stream_posts WHERE id = $1', [req.params.id]);
    return res.status(204).end();
  } catch (err) {
    req.log.error({ err }, 'DELETE /api/stream/posts/:id error');
    return res.status(500).json({ error: err.message || 'Failed to delete post' });
  }
});

export default router;
