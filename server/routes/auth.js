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
       RETURNING id, username, display_name, created_at, native_language, target_language, account_type, cefr_levels`,
      [username.trim(), passwordHash, display_name?.trim() || null],
    );

    const user = result.rows[0];
    const cefr_level = (user.cefr_levels && user.target_language) ? (user.cefr_levels[user.target_language] || null) : null;
    const token = signToken(user.id);

    res.cookie('token', token, COOKIE_OPTIONS);

    return res.status(201).json({
      token,
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      created_at: user.created_at,
      native_language: user.native_language,
      target_language: user.target_language,
      account_type: user.account_type,
      cefr_level,
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
      'SELECT id, username, password_hash, display_name, created_at, native_language, target_language, account_type, cefr_levels FROM users WHERE LOWER(username) = LOWER($1)',
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

    const cefr_level = (user.cefr_levels && user.target_language) ? (user.cefr_levels[user.target_language] || null) : null;
    const token = signToken(user.id);

    res.cookie('token', token, COOKIE_OPTIONS);

    return res.json({
      token,
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      created_at: user.created_at,
      native_language: user.native_language,
      target_language: user.target_language,
      account_type: user.account_type,
      cefr_level,
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
      'SELECT id, username, display_name, created_at, native_language, target_language, daily_new_limit, account_type, cefr_levels FROM users WHERE id = $1',
      [req.userId],
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const cefr_level = (user.cefr_levels && user.target_language) ? (user.cefr_levels[user.target_language] || null) : null;

    return res.json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      created_at: user.created_at,
      native_language: user.native_language,
      target_language: user.target_language,
      daily_new_limit: user.daily_new_limit,
      account_type: user.account_type,
      cefr_level,
    });
  } catch (err) {
    console.error('Get current user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/me/settings
 * Update the current user's language preferences.
 */
router.patch('/api/me/settings', authMiddleware, async (req, res) => {
  try {
    const { native_language, target_language, daily_new_limit, account_type, cefr_level } = req.body;

    if (account_type !== undefined && account_type !== 'student' && account_type !== 'teacher') {
      return res.status(400).json({ error: 'account_type must be "student" or "teacher"' });
    }

    const validCefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    if (cefr_level !== undefined && cefr_level !== null && !validCefrLevels.includes(cefr_level)) {
      return res.status(400).json({ error: 'cefr_level must be one of A1, A2, B1, B2, C1, C2' });
    }

    // Build SET clauses and params dynamically
    const sets = ['native_language = $1', 'target_language = $2'];
    const params = [native_language || null, target_language || null, req.userId];
    let idx = 4;

    if (daily_new_limit != null) {
      sets.push(`daily_new_limit = $${idx}`);
      params.push(daily_new_limit);
      idx++;
    }
    if (account_type) {
      sets.push(`account_type = $${idx}`);
      params.push(account_type);
      idx++;
    }

    // Store cefr_level into per-language cefr_levels JSONB map
    const effectiveTarget = (target_language || null);
    if (cefr_level !== undefined && effectiveTarget) {
      sets.push(`cefr_levels = jsonb_set(COALESCE(cefr_levels, '{}'), ARRAY[$${idx}], $${idx + 1}::jsonb)`);
      params.push(effectiveTarget, JSON.stringify(cefr_level));
      idx += 2;
    }

    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $3
       RETURNING id, username, display_name, created_at, native_language, target_language, daily_new_limit, account_type, cefr_levels`,
      params,
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const derivedCefrLevel = (user.cefr_levels && user.target_language) ? (user.cefr_levels[user.target_language] || null) : null;

    return res.json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      created_at: user.created_at,
      native_language: user.native_language,
      target_language: user.target_language,
      daily_new_limit: user.daily_new_limit,
      account_type: user.account_type,
      cefr_level: derivedCefrLevel,
    });
  } catch (err) {
    console.error('Update settings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
