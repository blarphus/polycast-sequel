import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import pool from '../db.js';
import {
  hashPassword,
  comparePassword,
  signToken,
  verifyToken,
  authMiddleware,
  COOKIE_OPTIONS,
} from '../auth.js';
import { validate } from '../lib/validate.js';

const signupSchema = z.object({
  username: z.string().min(1, 'Username is required').max(40, 'Username must be 40 characters or fewer').trim(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  display_name: z.string().trim().optional(),
});

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required').trim(),
  password: z.string().min(1, 'Password is required'),
});

const restoreSessionSchema = z.object({
  token: z.string().min(1, 'token is required'),
});

const settingsSchema = z.object({
  native_language: z.string().optional(),
  target_language: z.string().optional(),
  daily_new_limit: z.number().optional(),
  account_type: z.enum(['student', 'teacher']).optional(),
  cefr_level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable().optional(),
});

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a minute.' },
});

const signupLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts. Please try again in a minute.' },
});

/**
 * POST /api/signup
 * Create a new user account, sign a JWT, and set the token cookie.
 */
router.post('/api/signup', signupLimiter, validate({ body: signupSchema }), async (req, res) => {
  try {
    const { username, password, display_name } = req.body;

    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO users (username, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, username, display_name, created_at, native_language, target_language, account_type, cefr_level`,
      [username, passwordHash, display_name || null],
    );

    const user = result.rows[0];
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
      cefr_level: user.cefr_level ?? null,
    });
  } catch (err) {
    // Unique constraint violation on username
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already taken' });
    }

    req.log.error({ err }, 'Signup error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/login
 * Authenticate with username + password, sign a JWT, set the token cookie.
 */
router.post('/api/login', loginLimiter, validate({ body: loginSchema }), async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      'SELECT id, username, password_hash, display_name, created_at, native_language, target_language, account_type, cefr_level FROM users WHERE LOWER(username::text) = LOWER($1::text)',
      [username],
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
      token,
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      created_at: user.created_at,
      native_language: user.native_language,
      target_language: user.target_language,
      account_type: user.account_type,
      cefr_level: user.cefr_level ?? null,
    });
  } catch (err) {
    req.log.error({ err }, 'Login error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/session/restore
 * Restore the auth cookie from a previously saved JWT.
 */
router.post('/api/session/restore', validate({ body: restoreSessionSchema }), async (req, res) => {
  try {
    const decoded = verifyToken(req.body.token);
    if (!decoded?.userId) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const result = await pool.query(
      'SELECT id, username, display_name, created_at, native_language, target_language, daily_new_limit, account_type, cefr_level FROM users WHERE id = $1',
      [decoded.userId],
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const token = signToken(user.id);
    res.cookie('token', token, COOKIE_OPTIONS);

    return res.json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      created_at: user.created_at,
      native_language: user.native_language,
      target_language: user.target_language,
      daily_new_limit: user.daily_new_limit,
      account_type: user.account_type,
      cefr_level: user.cefr_level ?? null,
      token,
    });
  } catch (err) {
    req.log.error({ err }, 'Restore session error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/session/export
 * Issue a fresh JWT for the current authenticated user so the client can save it locally
 * for fast account switching on this device.
 */
router.post('/api/session/export', authMiddleware, async (req, res) => {
  try {
    const token = signToken(req.userId);
    res.cookie('token', token, COOKIE_OPTIONS);
    return res.json({ token });
  } catch (err) {
    req.log.error({ err }, 'Export session error');
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
      'SELECT id, username, display_name, created_at, native_language, target_language, daily_new_limit, account_type, cefr_level FROM users WHERE id = $1',
      [req.userId],
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      created_at: user.created_at,
      native_language: user.native_language,
      target_language: user.target_language,
      daily_new_limit: user.daily_new_limit,
      account_type: user.account_type,
      cefr_level: user.cefr_level ?? null,
    });
  } catch (err) {
    req.log.error({ err }, 'Get current user error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/me/settings
 * Update the current user's language preferences.
 */
router.patch('/api/me/settings', authMiddleware, validate({ body: settingsSchema }), async (req, res) => {
  try {
    const { native_language, target_language, daily_new_limit, account_type, cefr_level } = req.body;

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

    if (cefr_level !== undefined) {
      sets.push(`cefr_level = $${idx}`);
      params.push(cefr_level);
      idx++;
    }

    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $3
       RETURNING id, username, display_name, created_at, native_language, target_language, daily_new_limit, account_type, cefr_level`,
      params,
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      created_at: user.created_at,
      native_language: user.native_language,
      target_language: user.target_language,
      daily_new_limit: user.daily_new_limit,
      account_type: user.account_type,
      cefr_level: user.cefr_level ?? null,
    });
  } catch (err) {
    req.log.error({ err }, 'Update settings error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
