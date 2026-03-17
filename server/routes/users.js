import { Router } from 'express';
import { z } from 'zod';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';
import { userToSocket } from '../socket/presence.js';
import { validate } from '../lib/validate.js';

const router = Router();

const searchQuery = z.object({
  q: z.string().min(1, 'Search query is required'),
  account_type: z.string().optional(),
});

const iosVoipTokenBody = z.object({
  device_token: z.string().min(1, 'device_token is required'),
  apns_environment: z.enum(['sandbox', 'production']),
  bundle_id: z.string().min(1, 'bundle_id is required'),
});

/**
 * GET /api/users/search?q=<query>
 * Search users by username (case-insensitive), excluding the current user.
 * Returns up to 20 results with id, username, display_name, and online status.
 */
router.get('/api/users/search', authMiddleware, validate({ query: searchQuery }), async (req, res) => {
  try {
    const { q, account_type } = req.query;

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
    req.log.error({ err }, 'User search error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/users/me/ios-voip-token', authMiddleware, validate({ body: iosVoipTokenBody }), async (req, res) => {
  try {
    const { device_token, apns_environment, bundle_id } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO ios_voip_devices (user_id, device_token, apns_environment, bundle_id, updated_at, last_seen_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (device_token)
       DO UPDATE
         SET user_id = EXCLUDED.user_id,
             apns_environment = EXCLUDED.apns_environment,
             bundle_id = EXCLUDED.bundle_id,
             updated_at = NOW(),
             last_seen_at = NOW()
       RETURNING id, device_token, apns_environment, bundle_id`,
      [req.userId, device_token, apns_environment, bundle_id],
    );
    return res.json({ ok: true, device: rows[0] });
  } catch (err) {
    req.log.error({ err }, 'iOS VoIP token upsert error');
    return res.status(500).json({ error: 'Failed to save iOS VoIP token' });
  }
});

router.delete('/api/users/me/ios-voip-token', authMiddleware, validate({ body: z.object({ device_token: z.string().min(1) }) }), async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM ios_voip_devices WHERE user_id = $1 AND device_token = $2',
      [req.userId, req.body.device_token],
    );
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, 'iOS VoIP token delete error');
    return res.status(500).json({ error: 'Failed to delete iOS VoIP token' });
  }
});

export default router;
