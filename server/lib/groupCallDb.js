// ---------------------------------------------------------------------------
// lib/groupCallDb.js — Shared group-call DB helpers
// ---------------------------------------------------------------------------

import pool from '../db.js';

/**
 * Mark a participant as having left the active group call for a given post/date,
 * then end the call if no active participants remain.
 */
export async function markParticipantLeft(userId, postId, today) {
  await pool.query(
    `UPDATE group_call_participants SET left_at = NOW()
     WHERE user_id = $1 AND left_at IS NULL
       AND group_call_id IN (
         SELECT id FROM group_calls WHERE post_id = $2 AND session_date = $3 AND status = 'active'
       )`,
    [userId, postId, today],
  );

  await pool.query(
    `UPDATE group_calls SET status = 'ended', ended_at = NOW()
     WHERE post_id = $1 AND session_date = $2 AND status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM group_call_participants
         WHERE group_call_id = group_calls.id AND left_at IS NULL
       )`,
    [postId, today],
  );
}
