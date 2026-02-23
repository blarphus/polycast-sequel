import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';

const router = Router();

/**
 * GET /api/users/search?q=<query>
 * Search users by username (case-insensitive), excluding the current user.
 * Returns up to 20 results with id, username, and display_name.
 */
router.get('/api/users/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length === 0) {
      return res.json([]);
    }

    const searchTerm = `%${q.trim()}%`;

    const result = await pool.query(
      `SELECT id, username, display_name
       FROM users
       WHERE id != $1
         AND username ILIKE $2
       ORDER BY username ASC
       LIMIT 20`,
      [req.userId, searchTerm],
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('User search error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
