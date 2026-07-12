import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import pool from './db.js';
import { getUserById } from './lib/userQueries.js';
import logger from './logger.js';

const isExplicitDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
if (!process.env.JWT_SECRET && !isExplicitDevelopment) {
  throw new Error('JWT_SECRET must be configured outside explicit development/test environments');
}
if (!process.env.JWT_SECRET) {
  logger.warn('JWT_SECRET not set — using an insecure development-only secret');
}
const JWT_SECRET = process.env.JWT_SECRET || 'polycast-explicit-development-only-secret';
const SALT_ROUNDS = 12;
const DEFAULT_SESSION_TTL_DAYS = 1;
const configuredSessionTtlDays = Number.parseInt(process.env.SESSION_TTL_DAYS || '', 10);
const SESSION_TTL_DAYS = Number.isFinite(configuredSessionTtlDays) && configuredSessionTtlDays > 0
  ? configuredSessionTtlDays
  : DEFAULT_SESSION_TTL_DAYS;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: SESSION_TTL_MS,
};
const COOKIE_CLEAR_OPTIONS = {
  httpOnly: COOKIE_OPTIONS.httpOnly,
  secure: COOKIE_OPTIONS.secure,
  sameSite: COOKIE_OPTIONS.sameSite,
};

/**
 * Sign a JWT for the given user ID with the configured session expiry.
 */
export async function signToken(userId) {
  const { rows } = await pool.query(
    `INSERT INTO auth_sessions (user_id, expires_at)
     VALUES ($1, NOW() + ($2 || ' days')::interval)
     RETURNING id`,
    [userId, String(SESSION_TTL_DAYS)],
  );
  return jwt.sign({ userId, sessionId: rows[0].id }, JWT_SECRET, { expiresIn: `${SESSION_TTL_DAYS}d` });
}

/**
 * Verify a JWT and return the decoded payload, or null if invalid.
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    logger.warn('JWT verification failed: %s %s', err.name, err.message);
    return null;
  }
}

export async function isSessionActive(decoded) {
  if (!decoded?.userId || !decoded?.sessionId) return false;
  const { rowCount } = await pool.query(
    `UPDATE auth_sessions SET last_used_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > NOW()`,
    [decoded.sessionId, decoded.userId],
  );
  return rowCount === 1;
}

export async function revokeSession(sessionId, userId) {
  if (!sessionId || !userId) return;
  await pool.query(
    'UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [sessionId, userId],
  );
}

/**
 * Express middleware that reads the 'token' cookie, verifies it,
 * attaches req.userId, and responds 401 if invalid.
 */
export async function authMiddleware(req, res, next) {
  try {
    let token = req.cookies?.token;

  // Bearer token fallback for Chrome extension
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = verifyToken(token);

    if (!decoded || !await isSessionActive(decoded)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.userId = decoded.userId;
    req.sessionId = decoded.sessionId;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Hash a plaintext password with bcrypt.
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a plaintext password against a bcrypt hash.
 */
export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Middleware that verifies the authenticated user is a teacher.
 * Must be used after authMiddleware. Stashes the user row on req.userRecord.
 */
export async function requireTeacher(req, res, next) {
  const user = await getUserById(req.userId);
  if (!user || user.account_type !== 'teacher') {
    return res.status(403).json({ error: 'Teacher account required' });
  }
  req.userRecord = user;
  next();
}

export { COOKIE_OPTIONS, COOKIE_CLEAR_OPTIONS };
