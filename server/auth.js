import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import pool from './db.js';

if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET not set — using insecure dev-secret (development only)');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const SALT_ROUNDS = 12;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/**
 * Sign a JWT for the given user ID with a 7-day expiry.
 */
export function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

/**
 * Verify a JWT and return the decoded payload, or null if invalid.
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    console.warn('JWT verification failed:', err.name, err.message);
    return null;
  }
}

/**
 * Express middleware that reads the 'token' cookie, verifies it,
 * attaches req.userId, and responds 401 if invalid.
 */
export function authMiddleware(req, res, next) {
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

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.userId = decoded.userId;
  next();
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
  const { rows } = await pool.query(
    'SELECT account_type, native_language, target_language FROM users WHERE id = $1',
    [req.userId],
  );
  if (!rows[0] || rows[0].account_type !== 'teacher') {
    return res.status(403).json({ error: 'Teacher account required' });
  }
  req.userRecord = rows[0];
  next();
}

export { COOKIE_OPTIONS };
