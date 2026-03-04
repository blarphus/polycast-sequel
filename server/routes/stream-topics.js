import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, requireTeacher } from '../auth.js';
import pool from '../db.js';
import { validate } from '../lib/validate.js';

const router = Router();

const idParam = z.object({ id: z.string().uuid('Invalid topic ID') });

const createTopicBody = z.object({
  title: z.string().min(1, 'title is required').trim(),
});

const reorderBody = z.object({
  items: z.array(z.object({
    kind: z.enum(['post', 'topic']),
    id: z.string().uuid(),
    position: z.number().int(),
    topic_id: z.string().uuid().nullable().optional(),
  })).min(1, 'items array is required'),
});

// ---------------------------------------------------------------------------
// POST /api/stream/topics — create a topic (teacher only)
// ---------------------------------------------------------------------------

router.post('/api/stream/topics', authMiddleware, requireTeacher, validate({ body: createTopicBody }), async (req, res) => {
  const { title } = req.body;

  try {
    const { rows: maxRows } = await pool.query(
      'SELECT COALESCE(MAX(position), -1) AS max_pos FROM stream_topics WHERE teacher_id = $1',
      [req.userId],
    );
    const nextPos = (maxRows[0].max_pos ?? -1) + 1;

    const { rows } = await pool.query(
      `INSERT INTO stream_topics (teacher_id, title, position)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.userId, title, nextPos],
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    req.log.error({ err }, 'POST /api/stream/topics error');
    return res.status(500).json({ error: err.message || 'Failed to create topic' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/stream/topics/:id — rename a topic (teacher only, must own it)
// ---------------------------------------------------------------------------

router.patch('/api/stream/topics/:id', authMiddleware, validate({ params: idParam }), async (req, res) => {
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
    req.log.error({ err }, 'PATCH /api/stream/topics/:id error');
    return res.status(500).json({ error: err.message || 'Failed to update topic' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/stream/topics/:id — delete a topic; posts get topic_id = NULL
// ---------------------------------------------------------------------------

router.delete('/api/stream/topics/:id', authMiddleware, validate({ params: idParam }), async (req, res) => {
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
    req.log.error({ err }, 'DELETE /api/stream/topics/:id error');
    return res.status(500).json({ error: err.message || 'Failed to delete topic' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/stream/reorder — bulk reorder posts and/or topics (teacher only)
// ---------------------------------------------------------------------------

router.patch('/api/stream/reorder', authMiddleware, requireTeacher, validate({ body: reorderBody }), async (req, res) => {
  const { items } = req.body;

  try {
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
    req.log.error({ err }, 'PATCH /api/stream/reorder error');
    return res.status(500).json({ error: err.message || 'Failed to reorder' });
  }
});

export default router;
