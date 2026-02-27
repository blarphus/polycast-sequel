import pool from '../db.js';

export async function getUserDisplayInfo(userId) {
  const { rows } = await pool.query(
    'SELECT username, display_name FROM users WHERE id = $1',
    [userId],
  );
  return rows[0] || null;
}
