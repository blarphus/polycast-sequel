import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';
import { userToSocket } from '../socket/presence.js';

const router = Router();

/**
 * GET /api/users/search?q=<query>
 * Search users by username (case-insensitive), excluding the current user.
 * Returns up to 20 results with id, username, display_name, and online status.
 */
router.get('/api/users/search', authMiddleware, async (req, res) => {
  try {
    const { q, account_type } = req.query;

    if (!q || q.trim().length === 0) {
      return res.json([]);
    }

    const searchTerm = `%${q.trim()}%`;
    const params = [req.userId, searchTerm];
    let accountFilter = '';

    if (account_type) {
      params.push(account_type);
      accountFilter = ` AND account_type = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT id, username, display_name
       FROM users
       WHERE id != $1
         AND username ILIKE $2${accountFilter}
       ORDER BY username ASC
       LIMIT 20`,
      params,
    );

    // Attach online status from in-memory presence map
    const rows = result.rows.map((u) => ({
      ...u,
      online: userToSocket.has(u.id),
    }));

    return res.json(rows);
  } catch (err) {
    console.error('User search error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
