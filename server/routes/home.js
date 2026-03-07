import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';
import { listLegacyTeacherIdsForStudent } from '../services/classroomService.js';

const router = Router();

router.get('/api/home/student-dashboard', authMiddleware, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      'SELECT account_type, target_language, daily_new_limit FROM users WHERE id = $1',
      [req.userId],
    );
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (userRows[0].account_type !== 'student') {
      return res.status(403).json({ error: 'Student dashboard is only available to student accounts' });
    }

    const dailyNewLimit = userRows[0].daily_new_limit;
    const visibleTeacherIds = await listLegacyTeacherIdsForStudent(req.userId);

    const [newTodayResult, dueWordsResult, pendingClassworkResult] = await Promise.all([
      pool.query(
        `SELECT sw.* FROM saved_words sw
         JOIN users u ON u.id = sw.user_id
         WHERE sw.user_id = $1
           AND sw.target_language = u.target_language
           AND sw.due_at IS NULL
           AND sw.last_reviewed_at IS NULL
         ORDER BY
           CASE WHEN sw.queue_position IS NOT NULL THEN 0 ELSE 1 END ASC,
           sw.queue_position ASC NULLS LAST,
           CASE WHEN sw.priority = true THEN 0 ELSE 1 END ASC,
           sw.frequency DESC NULLS LAST,
           sw.created_at ASC
         LIMIT $2`,
        [req.userId, dailyNewLimit],
      ),
      pool.query(
        `SELECT * FROM saved_words
         WHERE user_id = $1
           AND target_language = $2
           AND (due_at <= NOW() OR due_at IS NULL)
         ORDER BY
           CASE WHEN learning_step IS NOT NULL THEN 0
                WHEN due_at IS NOT NULL THEN 1
                ELSE 2 END,
           due_at ASC NULLS LAST,
           CASE WHEN due_at IS NULL AND priority = true THEN 0 ELSE 1 END ASC,
           frequency DESC NULLS LAST,
           created_at ASC`,
        [req.userId, userRows[0].target_language],
      ),
      visibleTeacherIds.length === 0
        ? Promise.resolve({ rows: [] })
        : pool.query(
          `SELECT sp.id, sp.title, sp.created_at,
                  COALESCE(wc.cnt, 0)::int AS word_count,
                  COALESCE(u.display_name, u.username) AS teacher_name
           FROM stream_posts sp
           JOIN users u ON u.id = sp.teacher_id
           LEFT JOIN (
             SELECT post_id, COUNT(*) AS cnt FROM stream_post_words GROUP BY post_id
           ) wc ON wc.post_id = sp.id
           WHERE sp.type = 'word_list'
             AND sp.teacher_id = ANY($2::uuid[])
             AND NOT EXISTS (
               SELECT 1 FROM stream_word_list_completions swlc
               WHERE swlc.post_id = sp.id AND swlc.student_id = $1
             )
           ORDER BY sp.created_at DESC`,
          [req.userId, visibleTeacherIds],
        ),
    ]);

    return res.json({
      newToday: newTodayResult.rows,
      dueWords: dueWordsResult.rows,
      pendingClasswork: {
        count: pendingClassworkResult.rows.length,
        posts: pendingClassworkResult.rows,
      },
    });
  } catch (err) {
    req.log.error({ err }, 'GET /api/home/student-dashboard error');
    return res.status(500).json({ error: err.message || 'Failed to load student dashboard' });
  }
});

export default router;
