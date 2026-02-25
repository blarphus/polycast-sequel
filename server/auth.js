import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

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
  const token = req.cookies?.token;

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

export { COOKIE_OPTIONS };
