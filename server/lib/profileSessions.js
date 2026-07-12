import crypto from 'crypto';
import pool from '../db.js';

const COOKIE_NAME = 'polycast_profiles';
const TTL_DAYS = 30;
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: TTL_DAYS * 24 * 60 * 60 * 1000,
  path: '/',
};

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function findSession(rawToken) {
  if (!rawToken) return null;
  const { rows } = await pool.query(
    `SELECT id FROM profile_sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [hashToken(rawToken)],
  );
  return rows[0] || null;
}

export async function attachProfileSession(req, res, userId) {
  let rawToken = req.cookies?.[COOKIE_NAME];
  let session = await findSession(rawToken);
  if (!session) {
    rawToken = crypto.randomBytes(32).toString('base64url');
    const { rows } = await pool.query(
      `INSERT INTO profile_sessions (token_hash, expires_at)
       VALUES ($1, NOW() + ($2 || ' days')::interval)
       RETURNING id`,
      [hashToken(rawToken), String(TTL_DAYS)],
    );
    session = rows[0];
  }
  await pool.query(
    `INSERT INTO profile_session_accounts (profile_session_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (profile_session_id, user_id)
     DO UPDATE SET last_used_at = NOW()`,
    [session.id, userId],
  );
  await pool.query('UPDATE profile_sessions SET last_used_at = NOW() WHERE id = $1', [session.id]);
  res.cookie(COOKIE_NAME, rawToken, COOKIE_OPTIONS);
  return session.id;
}

export async function listProfileAccounts(req) {
  const session = await findSession(req.cookies?.[COOKIE_NAME]);
  if (!session) return [];
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.account_type,
            psa.last_used_at
     FROM profile_session_accounts psa
     JOIN users u ON u.id = psa.user_id
     WHERE psa.profile_session_id = $1
     ORDER BY psa.last_used_at DESC`,
    [session.id],
  );
  return rows;
}

export async function assertProfileAccess(req, userId) {
  const session = await findSession(req.cookies?.[COOKIE_NAME]);
  if (!session) return false;
  const { rowCount } = await pool.query(
    `UPDATE profile_session_accounts
     SET last_used_at = NOW()
     WHERE profile_session_id = $1 AND user_id = $2`,
    [session.id, userId],
  );
  return rowCount === 1;
}

export async function forgetProfile(req, userId) {
  const session = await findSession(req.cookies?.[COOKIE_NAME]);
  if (!session) return false;
  const { rowCount } = await pool.query(
    'DELETE FROM profile_session_accounts WHERE profile_session_id = $1 AND user_id = $2',
    [session.id, userId],
  );
  return rowCount === 1;
}

export { COOKIE_NAME as PROFILE_COOKIE_NAME, COOKIE_OPTIONS as PROFILE_COOKIE_OPTIONS };
