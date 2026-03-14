import pool from '../db.js';

export { getUserDisplayInfo } from './getUserDisplayInfo.js';

export async function getUserById(userId) {
  const { rows } = await pool.query(
    `SELECT id, username, display_name, account_type, native_language,
            target_language, cefr_level, daily_new_limit, created_at, updated_at
     FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] || null;
}

export async function getUserAccountType(userId) {
  const { rows } = await pool.query(
    'SELECT account_type FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.account_type || null;
}

export async function getUserLanguagePrefs(userId) {
  const { rows } = await pool.query(
    'SELECT native_language, target_language, cefr_level, cefr_levels FROM users WHERE id = $1',
    [userId],
  );
  return rows[0] || null;
}
