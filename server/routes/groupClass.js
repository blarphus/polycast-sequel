// ---------------------------------------------------------------------------
// routes/groupClass.js — REST endpoints for scheduled group classes
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/classes/today — classes scheduled for today (student or teacher)
// ---------------------------------------------------------------------------

router.get('/api/classes/today', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const user = req.userRecord;
    const isTeacher = user.account_type === 'teacher';

    // Get today's ISO weekday (1=Mon..7=Sun)
    const now = new Date();
    const jsDay = now.getDay(); // 0=Sun..6=Sat
    const isoDay = jsDay === 0 ? 7 : jsDay;

    let rows;

    if (isTeacher) {
      // Teacher sees their own class sessions
      const result = await pool.query(
        `SELECT sp.id, sp.title, sp.scheduled_at, sp.duration_minutes, sp.recurrence,
                u.display_name AS teacher_name, u.id AS teacher_id
         FROM stream_posts sp
         JOIN users u ON u.id = sp.teacher_id
         WHERE sp.type = 'class_session'
           AND sp.teacher_id = $1
           AND (
             sp.scheduled_at::date = CURRENT_DATE
             OR sp.recurrence IS NOT NULL
           )`,
        [userId],
      );
      rows = result.rows;
    } else {
      // Student sees class sessions from enrolled teachers
      const result = await pool.query(
        `SELECT sp.id, sp.title, sp.scheduled_at, sp.duration_minutes, sp.recurrence,
                u.display_name AS teacher_name, u.id AS teacher_id
         FROM stream_posts sp
         JOIN users u ON u.id = sp.teacher_id
         JOIN classroom_students cs ON cs.teacher_id = sp.teacher_id AND cs.student_id = $1
         WHERE sp.type = 'class_session'
           AND (
             sp.scheduled_at::date = CURRENT_DATE
             OR sp.recurrence IS NOT NULL
           )`,
        [userId],
      );
      rows = result.rows;
    }

    // Filter recurring classes: only include if today's weekday matches and date is within range
    const todayStr = now.toISOString().slice(0, 10);
    const classes = rows.filter((row) => {
      if (!row.recurrence) {
        // One-off: already filtered by SQL (scheduled_at::date = CURRENT_DATE)
        return row.scheduled_at && row.scheduled_at.toISOString().slice(0, 10) === todayStr;
      }
      const rec = typeof row.recurrence === 'string' ? JSON.parse(row.recurrence) : row.recurrence;
      if (!rec.days || !rec.days.includes(isoDay)) return false;
      if (rec.until && todayStr > rec.until) return false;
      return true;
    }).map((row) => {
      const rec = row.recurrence ? (typeof row.recurrence === 'string' ? JSON.parse(row.recurrence) : row.recurrence) : null;
      return {
        id: row.id,
        title: row.title,
        teacher_name: row.teacher_name || 'Teacher',
        teacher_id: row.teacher_id,
        scheduled_at: row.scheduled_at,
        duration_minutes: row.duration_minutes,
        time: rec ? rec.time : (row.scheduled_at ? new Date(row.scheduled_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : null),
      };
    });

    return res.json({ classes });
  } catch (err) {
    console.error('GET /api/classes/today error:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch classes' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/group-call/:postId/join — join a group call room
// ---------------------------------------------------------------------------

router.post('/api/group-call/:postId/join', authMiddleware, async (req, res) => {
  const { postId } = req.params;
  const userId = req.userId;

  try {
    // Verify the post exists and is a class_session
    const { rows: postRows } = await pool.query(
      `SELECT id, teacher_id FROM stream_posts WHERE id = $1 AND type = 'class_session'`,
      [postId],
    );
    if (postRows.length === 0) {
      return res.status(404).json({ error: 'Class session not found' });
    }
    const post = postRows[0];

    // Authorization: teacher owns post OR student enrolled with that teacher
    const user = req.userRecord;
    if (user.account_type === 'teacher' && post.teacher_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (user.account_type === 'student') {
      const { rows: enrollment } = await pool.query(
        `SELECT 1 FROM classroom_students WHERE teacher_id = $1 AND student_id = $2`,
        [post.teacher_id, userId],
      );
      if (enrollment.length === 0) {
        return res.status(403).json({ error: 'Not enrolled with this teacher' });
      }
    }

    // Find-or-create group_calls row for today
    const today = new Date().toISOString().slice(0, 10);

    let groupCallId;
    const { rows: existingCalls } = await pool.query(
      `SELECT id FROM group_calls WHERE post_id = $1 AND session_date = $2 AND status = 'active'`,
      [postId, today],
    );

    if (existingCalls.length > 0) {
      groupCallId = existingCalls[0].id;
    } else {
      const { rows: newCall } = await pool.query(
        `INSERT INTO group_calls (post_id, session_date) VALUES ($1, $2) RETURNING id`,
        [postId, today],
      );
      groupCallId = newCall[0].id;
    }

    // Check participant count < 8
    const { rows: currentParticipants } = await pool.query(
      `SELECT gcp.user_id, u.display_name, u.username
       FROM group_call_participants gcp
       JOIN users u ON u.id = gcp.user_id
       WHERE gcp.group_call_id = $1 AND gcp.left_at IS NULL`,
      [groupCallId],
    );

    if (currentParticipants.length >= 8) {
      return res.status(400).json({ error: 'Room is full (max 8 participants)' });
    }

    // Check if already in call
    const alreadyIn = currentParticipants.find((p) => p.user_id === userId);
    if (!alreadyIn) {
      await pool.query(
        `INSERT INTO group_call_participants (group_call_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (group_call_id, user_id) WHERE left_at IS NULL DO NOTHING`,
        [groupCallId, userId],
      );
    }

    const participants = currentParticipants.map((p) => ({
      userId: p.user_id,
      displayName: p.display_name || p.username,
      username: p.username,
    }));

    return res.json({ groupCallId, participants });
  } catch (err) {
    console.error('POST /api/group-call/:postId/join error:', err);
    return res.status(500).json({ error: err.message || 'Failed to join group call' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/group-call/:postId/leave — leave a group call
// ---------------------------------------------------------------------------

router.post('/api/group-call/:postId/leave', authMiddleware, async (req, res) => {
  const { postId } = req.params;
  const userId = req.userId;

  try {
    const today = new Date().toISOString().slice(0, 10);

    // Update left_at for this participant
    await pool.query(
      `UPDATE group_call_participants SET left_at = NOW()
       WHERE user_id = $1 AND left_at IS NULL
         AND group_call_id IN (
           SELECT id FROM group_calls WHERE post_id = $2 AND session_date = $3 AND status = 'active'
         )`,
      [userId, postId, today],
    );

    // End the group_call if no active participants remain
    await pool.query(
      `UPDATE group_calls SET status = 'ended', ended_at = NOW()
       WHERE post_id = $1 AND session_date = $2 AND status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM group_call_participants
           WHERE group_call_id = group_calls.id AND left_at IS NULL
         )`,
      [postId, today],
    );

    return res.status(204).send();
  } catch (err) {
    console.error('POST /api/group-call/:postId/leave error:', err);
    return res.status(500).json({ error: err.message || 'Failed to leave group call' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/group-call/:postId/participants — list active participants
// ---------------------------------------------------------------------------

router.get('/api/group-call/:postId/participants', authMiddleware, async (req, res) => {
  const { postId } = req.params;

  try {
    const today = new Date().toISOString().slice(0, 10);

    const { rows } = await pool.query(
      `SELECT gcp.user_id, u.display_name, u.username
       FROM group_call_participants gcp
       JOIN users u ON u.id = gcp.user_id
       JOIN group_calls gc ON gc.id = gcp.group_call_id
       WHERE gc.post_id = $1 AND gc.session_date = $2 AND gc.status = 'active'
         AND gcp.left_at IS NULL`,
      [postId, today],
    );

    const participants = rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name || r.username,
      username: r.username,
    }));

    return res.json({ participants });
  } catch (err) {
    console.error('GET /api/group-call/:postId/participants error:', err);
    return res.status(500).json({ error: err.message || 'Failed to get participants' });
  }
});

export default router;
