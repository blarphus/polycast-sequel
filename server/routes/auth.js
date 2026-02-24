import { Router } from 'express';
import pool from '../db.js';
import {
  hashPassword,
  comparePassword,
  signToken,
  authMiddleware,
  COOKIE_OPTIONS,
} from '../auth.js';

const router = Router();

/**
 * POST /api/signup
 * Create a new user account, sign a JWT, and set the token cookie.
 */
router.post('/api/signup', async (req, res) => {
  try {
    const { username, password, display_name } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length > 40) {
      return res.status(400).json({ error: 'Username must be 40 characters or fewer' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO users (username, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, username, display_name, created_at`,
      [username.trim(), passwordHash, display_name?.trim() || null],
    );

    const user = result.rows[0];
    const token = signToken(user.id);

    res.cookie('token', token, COOKIE_OPTIONS);

    return res.status(201).json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      created_at: user.created_at,
    });
  } catch (err) {
    // Unique constraint violation on username
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already taken' });
    }

    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/login
 * Authenticate with username + password, sign a JWT, set the token cookie.
 */
router.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await pool.query(
      'SELECT id, username, password_hash, display_name, created_at FROM users WHERE LOWER(username) = LOWER($1)',
      [username.trim()],
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const valid = await comparePassword(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = signToken(user.id);

    res.cookie('token', token, COOKIE_OPTIONS);

    return res.json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      created_at: user.created_at,
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/logout
 * Clear the token cookie.
 */
router.post('/api/logout', (_req, res) => {
  res.clearCookie('token', COOKIE_OPTIONS);

  return res.json({ message: 'Logged out' });
});

/**
 * GET /api/me
 * Return the currently authenticated user's info.
 */
router.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, display_name, created_at FROM users WHERE id = $1',
      [req.userId],
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(user);
  } catch (err) {
    console.error('Get current user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
