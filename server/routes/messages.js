import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';
import { userToSocket } from '../socket/presence.js';
import { getIO } from '../socket/index.js';

const router = Router();

/**
 * GET /api/conversations
 * All accepted friends + last message + unread count, ordered by last_message_at DESC.
 */
router.get('/api/conversations', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        u.id            AS friend_id,
        u.username      AS friend_username,
        u.display_name  AS friend_display_name,
        lm.body         AS last_message_body,
        lm.created_at   AS last_message_at,
        lm.sender_id    AS last_message_sender_id,
        COALESCE(unread.cnt, 0)::int AS unread_count
      FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.recipient_id ELSE f.requester_id END
      LEFT JOIN LATERAL (
        SELECT body, created_at, sender_id
        FROM messages
        WHERE LEAST(sender_id, receiver_id) = LEAST($1, u.id)
          AND GREATEST(sender_id, receiver_id) = GREATEST($1, u.id)
        ORDER BY created_at DESC
        LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt
        FROM messages
        WHERE sender_id = u.id AND receiver_id = $1 AND read_at IS NULL
      ) unread ON true
      WHERE f.status = 'accepted'
        AND (f.requester_id = $1 OR f.recipient_id = $1)
      ORDER BY lm.created_at DESC NULLS LAST, u.username ASC`,
      [req.userId],
    );

    const conversations = result.rows.map((row) => ({
      ...row,
      online: userToSocket.has(row.friend_id),
    }));

    return res.json(conversations);
  } catch (err) {
    console.error('GET /api/conversations error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/messages/:friendId
 * Cursor-paginated message history (both directions).
 * Query params: ?before=<uuid>&limit=50
 */
router.get('/api/messages/:friendId', authMiddleware, async (req, res) => {
  try {
    const { friendId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before || null;

    let query;
    let params;

    if (before) {
      query = `
        SELECT * FROM messages
        WHERE LEAST(sender_id, receiver_id) = LEAST($1, $2)
          AND GREATEST(sender_id, receiver_id) = GREATEST($1, $2)
          AND created_at < (SELECT created_at FROM messages WHERE id = $3)
        ORDER BY created_at DESC
        LIMIT $4`;
      params = [req.userId, friendId, before, limit + 1];
    } else {
      query = `
        SELECT * FROM messages
        WHERE LEAST(sender_id, receiver_id) = LEAST($1, $2)
          AND GREATEST(sender_id, receiver_id) = GREATEST($1, $2)
        ORDER BY created_at DESC
        LIMIT $3`;
      params = [req.userId, friendId, limit + 1];
    }

    const result = await pool.query(query, params);
    const hasMore = result.rows.length > limit;
    const messages = result.rows.slice(0, limit).reverse();

    return res.json({ messages, has_more: hasMore });
  } catch (err) {
    console.error('GET /api/messages/:friendId error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/messages/:friendId
 * Send a message (validates friendship). Emits message:new to recipient socket.
 * Body: { body }
 */
router.post('/api/messages/:friendId', authMiddleware, async (req, res) => {
  try {
    const { friendId } = req.params;
    const { body } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Message body is required' });
    }

    // Validate friendship exists
    const friendship = await pool.query(
      `SELECT id FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = $1 AND recipient_id = $2) OR (requester_id = $2 AND recipient_id = $1))`,
      [req.userId, friendId],
    );

    if (friendship.rows.length === 0) {
      return res.status(403).json({ error: 'You are not friends with this user' });
    }

    const result = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, body)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.userId, friendId, body.trim()],
    );

    const message = result.rows[0];

    // Emit to recipient if online
    const recipientSocketId = userToSocket.get(friendId);
    if (recipientSocketId) {
      const io = getIO();
      if (io) {
        io.to(recipientSocketId).emit('message:new', message);
      }
    }

    return res.status(201).json(message);
  } catch (err) {
    console.error('POST /api/messages/:friendId error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/messages/:friendId/read
 * Mark all unread messages from friendId as read. Emits message:read to friend.
 */
router.post('/api/messages/:friendId/read', authMiddleware, async (req, res) => {
  try {
    const { friendId } = req.params;

    const result = await pool.query(
      `UPDATE messages SET read_at = NOW()
       WHERE sender_id = $1 AND receiver_id = $2 AND read_at IS NULL`,
      [friendId, req.userId],
    );

    const updated = result.rowCount;

    // Emit read receipt to friend if online
    if (updated > 0) {
      const friendSocketId = userToSocket.get(friendId);
      if (friendSocketId) {
        const io = getIO();
        if (io) {
          io.to(friendSocketId).emit('message:read', { userId: req.userId });
        }
      }
    }

    return res.json({ updated });
  } catch (err) {
    console.error('POST /api/messages/:friendId/read error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
