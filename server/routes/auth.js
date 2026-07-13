import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import pool from '../db.js';
import {
  hashPassword,
  comparePassword,
  signToken,
  verifyToken,
  isSessionActive,
  revokeSession,
  authMiddleware,
  COOKIE_OPTIONS,
  COOKIE_CLEAR_OPTIONS,
} from '../auth.js';
import { validate } from '../lib/validate.js';
import {
  assertProfileAccess,
  attachProfileSession,
  forgetProfile,
  listProfileAccounts,
} from '../lib/profileSessions.js';
import { serializeAuthUser } from '../lib/authResponse.js';
import { supportedLanguageSchema } from '../lib/languagePolicy.js';

const signupSchema = z.object({
  username: z.string().min(1, 'Username is required').max(40, 'Username must be 40 characters or fewer').trim(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  display_name: z.string().trim().optional(),
}).strict();

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required').trim(),
  password: z.string().min(1, 'Password is required'),
}).strict();

const restoreSessionSchema = z.object({
  token: z.string().min(1, 'token is required'),
}).strict();

const settingsSchema = z.object({
  native_language: supportedLanguageSchema.optional(),
  target_language: supportedLanguageSchema.optional(),
  daily_new_limit: z.number().optional(),
  daily_word_goal: z.number().int().min(1).max(50).optional(),
  cefr_level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable().optional(),
}).strict();

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
       RETURNING id, username, display_name, created_at, native_language, target_language, daily_new_limit, daily_word_goal, total_xp, account_type, cefr_level`,
      [username, passwordHash, display_name || null],
    );

    const user = result.rows[0];
    const token = await signToken(user.id);

    res.cookie('token', token, COOKIE_OPTIONS);
    await attachProfileSession(req, res, user.id);

    return res.status(201).json(serializeAuthUser(user, token));
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
      'SELECT id, username, password_hash, display_name, created_at, native_language, target_language, daily_new_limit, daily_word_goal, total_xp, account_type, cefr_level FROM users WHERE LOWER(username::text) = LOWER($1::text)',
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

    const token = await signToken(user.id);

    res.cookie('token', token, COOKIE_OPTIONS);
    await attachProfileSession(req, res, user.id);

    return res.json(serializeAuthUser(user, token));
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
    if (!decoded?.userId || !await isSessionActive(decoded)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const result = await pool.query(
      'SELECT id, username, display_name, created_at, native_language, target_language, daily_new_limit, daily_word_goal, total_xp, account_type, cefr_level FROM users WHERE id = $1',
      [decoded.userId],
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await revokeSession(decoded.sessionId, decoded.userId);
    const token = await signToken(user.id);
    res.cookie('token', token, COOKIE_OPTIONS);

    return res.json(serializeAuthUser(user, token));
  } catch (err) {
    req.log.error({ err }, 'Restore session error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/session/export
 * Rotate the current native/extension bearer session.
 */
router.post('/api/session/export', authMiddleware, async (req, res) => {
  try {
    await revokeSession(req.sessionId, req.userId);
    const token = await signToken(req.userId);
    res.cookie('token', token, COOKIE_OPTIONS);
    return res.json({ token });
  } catch (err) {
    req.log.error({ err }, 'Export session error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/session/accounts', async (req, res) => {
  try {
    return res.json({ accounts: await listProfileAccounts(req) });
  } catch (err) {
    req.log.error({ err }, 'List profile sessions error');
    return res.status(500).json({ error: 'Failed to list profiles' });
  }
});

router.post('/api/session/switch', validate({ body: z.object({ userId: z.string().uuid() }) }), async (req, res) => {
  try {
    if (!await assertProfileAccess(req, req.body.userId)) {
      return res.status(403).json({ error: 'Profile is not available on this device' });
    }
    const { rows } = await pool.query(
      'SELECT id, username, display_name, created_at, native_language, target_language, daily_new_limit, daily_word_goal, total_xp, account_type, cefr_level FROM users WHERE id = $1',
      [req.body.userId],
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const token = await signToken(user.id);
    res.cookie('token', token, COOKIE_OPTIONS);
    return res.json(serializeAuthUser(user));
  } catch (err) {
    req.log.error({ err }, 'Switch profile session error');
    return res.status(500).json({ error: 'Failed to switch profile' });
  }
});

router.delete('/api/session/accounts/:userId', async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.userId)) return res.status(400).json({ error: 'Invalid user ID' });
    await forgetProfile(req, req.params.userId);
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, 'Forget profile session error');
    return res.status(500).json({ error: 'Failed to forget profile' });
  }
});

/**
 * POST /api/logout
 * Clear the token cookie.
 */
router.post('/api/logout', async (req, res) => {
  const rawToken = req.cookies?.token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const decoded = rawToken ? verifyToken(rawToken) : null;
  if (decoded?.sessionId && decoded?.userId) {
    await revokeSession(decoded.sessionId, decoded.userId);
  }
  res.clearCookie('token', COOKIE_CLEAR_OPTIONS);

  return res.json({ message: 'Logged out' });
});

/**
 * GET /api/me
 * Return the currently authenticated user's info.
 */
router.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, display_name, created_at, native_language, target_language, daily_new_limit, daily_word_goal, total_xp, account_type, cefr_level FROM users WHERE id = $1',
      [req.userId],
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(serializeAuthUser(user));
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
    const { native_language, target_language, daily_new_limit, daily_word_goal, cefr_level } = req.body;

    // Build SET clauses and params dynamically
    const sets = ['native_language = $1', 'target_language = $2'];
    const params = [native_language || null, target_language || null, req.userId];
    let idx = 4;

    if (daily_new_limit != null) {
      sets.push(`daily_new_limit = $${idx}`);
      params.push(daily_new_limit);
      idx++;
    }
    if (daily_word_goal != null) {
      sets.push(`daily_word_goal = $${idx}`);
      params.push(daily_word_goal);
      idx++;
    }

    if (cefr_level !== undefined) {
      sets.push(`cefr_level = $${idx}`);
      params.push(cefr_level);
      idx++;
    }

    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $3
       RETURNING id, username, display_name, created_at, native_language, target_language, daily_new_limit, daily_word_goal, total_xp, account_type, cefr_level`,
      params,
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(serializeAuthUser(user));
  } catch (err) {
    req.log.error({ err }, 'Update settings error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
