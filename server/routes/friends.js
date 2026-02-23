import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';
import { userToSocket } from '../socket/presence.js';
import { getIO } from '../socket/index.js';

const router = Router();

/**
 * POST /api/friends/request
 * Send a friend request to another user.
 * Body: { userId }
 */
router.post('/api/friends/request', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Cannot friend yourself
    if (userId === req.userId) {
      return res.status(400).json({ error: 'Cannot send a friend request to yourself' });
    }

    // Check for existing friendship in either direction
    const existing = await pool.query(
      `SELECT id, status FROM friendships
       WHERE (requester_id = $1 AND recipient_id = $2)
          OR (requester_id = $2 AND recipient_id = $1)`,
      [req.userId, userId],
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Friendship already exists', friendship: existing.rows[0] });
    }

    // Insert the friend request
    const result = await pool.query(
      `INSERT INTO friendships (requester_id, recipient_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [req.userId, userId],
    );

    const friendship = result.rows[0];

    // Look up requester info for the socket event
    const requesterResult = await pool.query(
      'SELECT username, display_name FROM users WHERE id = $1',
      [req.userId],
    );
    const requester = requesterResult.rows[0];

    // Emit socket event to recipient if they are online
    const recipientSocketId = userToSocket.get(userId);
    if (recipientSocketId) {
      const io = getIO();
      if (io) {
        io.to(recipientSocketId).emit('friend:request', {
          id: friendship.id,
          requester_id: req.userId,
          username: requester?.username,
          display_name: requester?.display_name,
          created_at: friendship.created_at,
        });
      }
    }

    return res.status(201).json(friendship);
  } catch (err) {
    console.error('POST /api/friends/request error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/friends
 * List all accepted friends for the authenticated user.
 */
router.get('/api/friends', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        f.id AS friendship_id,
        CASE
          WHEN f.requester_id = $1 THEN u2.id
          ELSE u1.id
        END AS id,
        CASE
          WHEN f.requester_id = $1 THEN u2.username
          ELSE u1.username
        END AS username,
        CASE
          WHEN f.requester_id = $1 THEN u2.display_name
          ELSE u1.display_name
        END AS display_name
      FROM friendships f
      JOIN users u1 ON u1.id = f.requester_id
      JOIN users u2 ON u2.id = f.recipient_id
      WHERE f.status = 'accepted'
        AND (f.requester_id = $1 OR f.recipient_id = $1)`,
      [req.userId],
    );

    const friends = result.rows.map((row) => ({
      friendship_id: row.friendship_id,
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      online: userToSocket.has(row.id),
    }));

    return res.json(friends);
  } catch (err) {
    console.error('GET /api/friends error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/friends/requests
 * List pending friend requests received by the authenticated user.
 */
router.get('/api/friends/requests', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id, f.requester_id, u.username, u.display_name, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.recipient_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.userId],
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('GET /api/friends/requests error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/friends/:id/accept
 * Accept a pending friend request.
 */
router.post('/api/friends/:id/accept', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Find the pending request where current user is the recipient
    const existing = await pool.query(
      `SELECT * FROM friendships WHERE id = $1 AND recipient_id = $2 AND status = 'pending'`,
      [id, req.userId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    // Update status to accepted
    const result = await pool.query(
      `UPDATE friendships SET status = 'accepted' WHERE id = $1 RETURNING *`,
      [id],
    );

    const friendship = result.rows[0];

    // Look up accepter info for the socket event
    const accepterResult = await pool.query(
      'SELECT username, display_name FROM users WHERE id = $1',
      [req.userId],
    );
    const accepter = accepterResult.rows[0];

    // Emit socket event to the requester if they are online
    const requesterSocketId = userToSocket.get(friendship.requester_id);
    if (requesterSocketId) {
      const io = getIO();
      if (io) {
        io.to(requesterSocketId).emit('friend:accepted', {
          friendship_id: friendship.id,
          recipient_id: req.userId,
          username: accepter?.username,
          display_name: accepter?.display_name,
        });
      }
    }

    return res.json(friendship);
  } catch (err) {
    console.error('POST /api/friends/:id/accept error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/friends/:id/reject
 * Reject a pending friend request.
 */
router.post('/api/friends/:id/reject', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Find the pending request where current user is the recipient
    const existing = await pool.query(
      `SELECT * FROM friendships WHERE id = $1 AND recipient_id = $2 AND status = 'pending'`,
      [id, req.userId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    // Delete the request
    await pool.query('DELETE FROM friendships WHERE id = $1', [id]);

    return res.json({ message: 'Request rejected' });
  } catch (err) {
    console.error('POST /api/friends/:id/reject error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/friends/:id
 * Remove an accepted friendship.
 */
router.delete('/api/friends/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Find the accepted friendship where current user is either party
    const existing = await pool.query(
      `SELECT * FROM friendships
       WHERE id = $1
         AND status = 'accepted'
         AND (requester_id = $2 OR recipient_id = $2)`,
      [id, req.userId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    // Delete the friendship
    await pool.query('DELETE FROM friendships WHERE id = $1', [id]);

    return res.json({ message: 'Friend removed' });
  } catch (err) {
    console.error('DELETE /api/friends/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
