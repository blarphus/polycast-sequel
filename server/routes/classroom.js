import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware, requireTeacher } from '../auth.js';
import { userToSocket } from '../socket/presence.js';

const router = Router();

/**
 * GET /api/classroom/students
 * List the teacher's classroom students with online status.
 */
router.get('/api/classroom/students', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cs.id AS classroom_id, cs.created_at AS added_at,
              u.id, u.username, u.display_name
       FROM classroom_students cs
       JOIN users u ON u.id = cs.student_id
       WHERE cs.teacher_id = $1
       ORDER BY u.username ASC`,
      [req.userId],
    );

    const rows = result.rows.map((r) => ({
      classroom_id: r.classroom_id,
      id: r.id,
      username: r.username,
      display_name: r.display_name,
      online: userToSocket.has(r.id),
      added_at: r.added_at,
    }));

    return res.json(rows);
  } catch (err) {
    console.error('GET /api/classroom/students error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/classroom/students
 * Add a student to the teacher's classroom.
 * Body: { studentId }
 */
router.post('/api/classroom/students', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { studentId } = req.body;

    if (!studentId) {
      return res.status(400).json({ error: 'studentId is required' });
    }

    // Verify target is a student
    const studentCheck = await pool.query(
      `SELECT account_type FROM users WHERE id = $1`,
      [studentId],
    );
    if (!studentCheck.rows[0]) {
      return res.status(404).json({ error: 'Student not found' });
    }
    if (studentCheck.rows[0].account_type !== 'student') {
      return res.status(400).json({ error: 'Target user is not a student account' });
    }

    const result = await pool.query(
      `INSERT INTO classroom_students (teacher_id, student_id)
       VALUES ($1, $2)
       RETURNING *`,
      [req.userId, studentId],
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    // Unique constraint violation — student already in classroom
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Student already in classroom' });
    }
    console.error('POST /api/classroom/students error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/classroom/students/:studentId
 * Remove a student from the teacher's classroom.
 */
router.delete('/api/classroom/students/:studentId', authMiddleware, async (req, res) => {
  try {
    const { studentId } = req.params;

    const result = await pool.query(
      `DELETE FROM classroom_students WHERE teacher_id = $1 AND student_id = $2 RETURNING id`,
      [req.userId, studentId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found in classroom' });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /api/classroom/students/:studentId error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/classroom/students/:studentId/stats
 * Get a student's info, aggregate stats, and full word list.
 * Requires the student to be in the teacher's classroom.
 */
router.get('/api/classroom/students/:studentId/stats', authMiddleware, async (req, res) => {
  try {
    const { studentId } = req.params;

    // Verify classroom relationship
    const relationship = await pool.query(
      `SELECT id FROM classroom_students WHERE teacher_id = $1 AND student_id = $2`,
      [req.userId, studentId],
    );
    if (relationship.rows.length === 0) {
      return res.status(403).json({ error: 'Student is not in your classroom' });
    }

    // Get student info
    const studentResult = await pool.query(
      `SELECT id, username, display_name FROM users WHERE id = $1`,
      [studentId],
    );
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const student = studentResult.rows[0];

    // Get all words for stats computation + word list
    const wordsResult = await pool.query(
      `SELECT id, word, translation, part_of_speech, srs_interval, due_at,
              last_reviewed_at, correct_count, incorrect_count, learning_step, created_at
       FROM saved_words
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [studentId],
    );

    const words = wordsResult.rows;
    const now = new Date();

    const totalWords = words.length;
    const wordsLearned = words.filter((w) => w.learning_step === null && w.srs_interval > 0).length;
    const wordsDue = words.filter((w) => w.due_at && new Date(w.due_at) <= now).length;
    const wordsNew = words.filter((w) => w.srs_interval === 0 && w.learning_step === null && !w.last_reviewed_at).length;
    const wordsInLearning = words.filter((w) => w.learning_step !== null).length;

    const totalCorrect = words.reduce((sum, w) => sum + (w.correct_count || 0), 0);
    const totalIncorrect = words.reduce((sum, w) => sum + (w.incorrect_count || 0), 0);
    const totalReviews = totalCorrect + totalIncorrect;
    const accuracy = totalReviews > 0 ? totalCorrect / totalReviews : null;

    const reviewDates = words.map((w) => w.last_reviewed_at).filter(Boolean);
    const lastReviewedAt = reviewDates.length > 0
      ? reviewDates.reduce((latest, d) => (new Date(d) > new Date(latest) ? d : latest))
      : null;

    return res.json({
      student,
      stats: {
        totalWords,
        wordsLearned,
        wordsDue,
        wordsNew,
        wordsInLearning,
        totalReviews,
        accuracy,
        lastReviewedAt,
      },
      words: words.map((w) => ({
        id: w.id,
        word: w.word,
        translation: w.translation,
        part_of_speech: w.part_of_speech,
      })),
    });
  } catch (err) {
    console.error('GET /api/classroom/students/:studentId/stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
