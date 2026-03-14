import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';
import { listLegacyTeacherIdsForStudent } from '../services/classroomService.js';
import { listDueWords, listNewTodayWords } from '../lib/dictionaryQueries.js';

const router = Router();

router.get('/api/home/student-dashboard', authMiddleware, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      'SELECT account_type FROM users WHERE id = $1',
      [req.userId],
    );
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (userRows[0].account_type !== 'student') {
      return res.status(403).json({ error: 'Student dashboard is only available to student accounts' });
    }

    const visibleTeacherIds = await listLegacyTeacherIdsForStudent(req.userId);

    const [newTodayResult, dueWordsResult, pendingClassworkResult] = await Promise.all([
      listNewTodayWords(pool, req.userId),
      listDueWords(pool, req.userId),
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
