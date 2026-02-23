import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';

const router = Router();

/**
 * GET /api/calls
 * Return call history for the current user (as caller or callee).
 * Joins with users table to include usernames. Ordered by most recent first.
 * Limited to 50 records.
 */
router.get('/api/calls', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         c.id,
         c.caller_id,
         c.callee_id,
         c.status,
         c.started_at,
         c.ended_at,
         c.duration_seconds,
         caller.username   AS caller_username,
         caller.display_name AS caller_display_name,
         callee.username   AS callee_username,
         callee.display_name AS callee_display_name
       FROM calls c
       JOIN users caller ON caller.id = c.caller_id
       JOIN users callee ON callee.id = c.callee_id
       WHERE c.caller_id = $1 OR c.callee_id = $1
       ORDER BY c.started_at DESC
       LIMIT 50`,
      [req.userId],
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('Get calls error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
