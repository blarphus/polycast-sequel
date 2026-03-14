import pool from '../db.js';
import { userToSocket } from '../socket/presence.js';
import { generateUniqueClassIdentity } from '../lib/classroomIdentity.js';
import { getUserAccountType } from '../lib/userQueries.js';
import { httpError } from '../lib/httpError.js';

function mapClassroomRow(row, roleOverride) {
  return {
    id: row.id,
    name: row.name,
    section: row.section,
    subject: row.subject,
    room: row.room,
    target_language: row.target_language || null,
    native_language: row.native_language || null,
    class_code: row.class_code ?? null,
    archived: !!row.archived_at,
    is_default_migrated: !!row.is_default_migrated,
    needs_setup: !!row.needs_setup,
    teacher_count: Number(row.teacher_count || 0),
    student_count: Number(row.student_count || 0),
    teacher_names: row.teacher_names || [],
    role: roleOverride || row.role || null,
    next_class_title: row.next_class_title || null,
    next_class_at: row.next_class_at || null,
  };
}

async function getTeacherNameAggregateSubquery() {
  return `
    SELECT ct.classroom_id,
           ARRAY_AGG(COALESCE(u.display_name, u.username) ORDER BY COALESCE(u.display_name, u.username)) AS teacher_names
    FROM classroom_teachers ct
    JOIN users u ON u.id = ct.teacher_id
    GROUP BY ct.classroom_id
  `;
}

export async function listVisibleClassrooms(userId) {
  const accountType = await getUserAccountType(userId);
  const teacherNamesSql = await getTeacherNameAggregateSubquery();
  const baseSql = `
    LEFT JOIN (
      SELECT classroom_id, COUNT(*)::int AS teacher_count
      FROM classroom_teachers
      GROUP BY classroom_id
    ) tc ON tc.classroom_id = c.id
    LEFT JOIN (
      SELECT classroom_id, COUNT(*)::int AS student_count
      FROM classroom_enrollments
      GROUP BY classroom_id
    ) sc ON sc.classroom_id = c.id
    LEFT JOIN (${teacherNamesSql}) tn ON tn.classroom_id = c.id
    LEFT JOIN LATERAL (
      SELECT sp.title AS next_class_title, sp.scheduled_at AS next_class_at
      FROM stream_posts sp
      JOIN classroom_teachers ct2 ON ct2.teacher_id = sp.teacher_id AND ct2.classroom_id = c.id
      WHERE sp.type = 'class_session'
        AND sp.scheduled_at >= NOW()
      ORDER BY sp.scheduled_at ASC
      LIMIT 1
    ) nc ON true
  `;

  if (accountType === 'teacher') {
    const { rows } = await pool.query(
      `SELECT c.*, ct.role,
              COALESCE(tc.teacher_count, 0) AS teacher_count,
              COALESCE(sc.student_count, 0) AS student_count,
              COALESCE(tn.teacher_names, ARRAY[]::text[]) AS teacher_names,
              nc.next_class_title,
              nc.next_class_at
       FROM classrooms c
       JOIN classroom_teachers ct
         ON ct.classroom_id = c.id
        AND ct.teacher_id = $1
       ${baseSql}
       WHERE c.archived_at IS NULL
       ORDER BY c.needs_setup DESC, c.is_default_migrated DESC, c.created_at ASC`,
      [userId],
    );
    return rows.map((row) => mapClassroomRow(row));
  }

  const { rows } = await pool.query(
    `SELECT c.*,
            'student' AS role,
            COALESCE(tc.teacher_count, 0) AS teacher_count,
            COALESCE(sc.student_count, 0) AS student_count,
            COALESCE(tn.teacher_names, ARRAY[]::text[]) AS teacher_names,
            nc.next_class_title,
            nc.next_class_at
     FROM classrooms c
     JOIN classroom_enrollments ce
       ON ce.classroom_id = c.id
      AND ce.student_id = $1
     ${baseSql}
     WHERE c.archived_at IS NULL
     ORDER BY c.created_at ASC`,
    [userId],
  );
  return rows.map((row) => mapClassroomRow(row, 'student'));
}

export async function getClassroomForUser(classroomId, userId) {
  const accountType = await getUserAccountType(userId);
  const teacherNamesSql = await getTeacherNameAggregateSubquery();
  const membershipJoin = accountType === 'teacher'
    ? `JOIN classroom_teachers m ON m.classroom_id = c.id AND m.teacher_id = $2`
    : `JOIN classroom_enrollments m ON m.classroom_id = c.id AND m.student_id = $2`;
  const roleField = accountType === 'teacher' ? 'm.role' : `'student'`;
  const { rows } = await pool.query(
    `SELECT c.*,
            ${roleField} AS role,
            COALESCE(tc.teacher_count, 0) AS teacher_count,
            COALESCE(sc.student_count, 0) AS student_count,
            COALESCE(tn.teacher_names, ARRAY[]::text[]) AS teacher_names
     FROM classrooms c
     ${membershipJoin}
     LEFT JOIN (
       SELECT classroom_id, COUNT(*)::int AS teacher_count
       FROM classroom_teachers
       GROUP BY classroom_id
     ) tc ON tc.classroom_id = c.id
     LEFT JOIN (
       SELECT classroom_id, COUNT(*)::int AS student_count
       FROM classroom_enrollments
       GROUP BY classroom_id
     ) sc ON sc.classroom_id = c.id
     LEFT JOIN (${teacherNamesSql}) tn ON tn.classroom_id = c.id
     WHERE c.id = $1
     LIMIT 1`,
    [classroomId, userId],
  );
  return rows[0] ? mapClassroomRow(rows[0]) : null;
}

export async function createClassroom({ teacherId, name, section, subject, room, target_language, native_language }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { classCode, inviteToken } = await generateUniqueClassIdentity(client);
    const { rows: classroomRows } = await client.query(
      `INSERT INTO classrooms (
         name, section, subject, room, target_language, native_language, class_code, invite_token, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [name, section || null, subject || null, room || null, target_language || null, native_language || null, classCode, inviteToken, teacherId],
    );
    const classroom = classroomRows[0];
    await client.query(
      `INSERT INTO classroom_teachers (classroom_id, teacher_id, role)
       VALUES ($1, $2, 'owner')`,
      [classroom.id, teacherId],
    );
    await client.query('COMMIT');
    return getClassroomForUser(classroom.id, teacherId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateClassroom({ classroomId, teacherId, patch }) {
  const membership = await pool.query(
    `SELECT role FROM classroom_teachers WHERE classroom_id = $1 AND teacher_id = $2`,
    [classroomId, teacherId],
  );
  if (!membership.rows[0]) {
    throw httpError(403, 'Not in classroom');
  }

  const fields = [];
  const values = [];
  for (const key of ['name', 'section', 'subject', 'room', 'target_language', 'native_language', 'needs_setup']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      values.push(patch[key] ?? null);
      fields.push(`${key} = $${values.length}`);
    }
  }
  if (fields.length === 0) {
    return getClassroomForUser(classroomId, teacherId);
  }
  values.push(classroomId);
  await pool.query(
    `UPDATE classrooms
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length}`,
    values,
  );
  return getClassroomForUser(classroomId, teacherId);
}

export async function deleteClassroom(classroomId, teacherId) {
  const membership = await pool.query(
    `SELECT role FROM classroom_teachers WHERE classroom_id = $1 AND teacher_id = $2`,
    [classroomId, teacherId],
  );
  if (!membership.rows[0]) {
    throw httpError(403, 'Not in classroom');
  }
  if (membership.rows[0].role !== 'owner') {
    throw httpError(403, 'Only the class owner can delete a classroom');
  }
  await pool.query('DELETE FROM classrooms WHERE id = $1', [classroomId]);
}

export async function getTeacherDefaultClassroom(teacherId) {
  const { rows } = await pool.query(
    `SELECT c.*
     FROM classrooms c
     JOIN classroom_teachers ct ON ct.classroom_id = c.id AND ct.teacher_id = $1
     WHERE c.is_default_migrated = true
     ORDER BY c.created_at ASC
     LIMIT 1`,
    [teacherId],
  );
  return rows[0] || null;
}

export async function getClassroomTopics(classroomId) {
  const { rows } = await pool.query(
    `SELECT * FROM classroom_topics
     WHERE classroom_id = $1
     ORDER BY position ASC, created_at ASC`,
    [classroomId],
  );
  return rows;
}

export async function createClassroomTopic(classroomId, title) {
  const { rows: maxRows } = await pool.query(
    `SELECT COALESCE(MAX(position), -1) AS max_pos
     FROM classroom_topics
     WHERE classroom_id = $1`,
    [classroomId],
  );
  const nextPos = Number(maxRows[0]?.max_pos ?? -1) + 1;
  const { rows } = await pool.query(
    `INSERT INTO classroom_topics (classroom_id, title, position)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [classroomId, title, nextPos],
  );
  return rows[0];
}

export async function listClassroomStudents(classroomId) {
  const result = await pool.query(
    `SELECT ce.classroom_id, ce.created_at AS added_at,
            u.id, u.username, u.display_name
     FROM classroom_enrollments ce
     JOIN users u ON u.id = ce.student_id
     WHERE ce.classroom_id = $1
     ORDER BY u.username ASC`,
    [classroomId],
  );
  return result.rows.map((row) => ({
    classroom_id: row.classroom_id,
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    online: userToSocket.has(row.id),
    added_at: row.added_at,
  }));
}

export async function addStudentToClassroom(classroomId, studentId, actorTeacherId) {
  const membership = await pool.query(
    `SELECT 1 FROM classroom_teachers WHERE classroom_id = $1 AND teacher_id = $2`,
    [classroomId, actorTeacherId],
  );
  if (membership.rows.length === 0) {
    throw httpError(403, 'Not in classroom');
  }

  const studentCheck = await pool.query(
    `SELECT account_type FROM users WHERE id = $1`,
    [studentId],
  );
  if (!studentCheck.rows[0]) {
    throw httpError(404, 'Student not found');
  }
  if (studentCheck.rows[0].account_type !== 'student') {
    throw httpError(400, 'Target user is not a student account');
  }

  const { rows } = await pool.query(
    `INSERT INTO classroom_enrollments (classroom_id, student_id)
     VALUES ($1, $2)
     RETURNING classroom_id`,
    [classroomId, studentId],
  );
  return rows[0];
}

export async function removeStudentFromClassroom(classroomId, studentId, actorTeacherId) {
  const membership = await pool.query(
    `SELECT 1 FROM classroom_teachers WHERE classroom_id = $1 AND teacher_id = $2`,
    [classroomId, actorTeacherId],
  );
  if (membership.rows.length === 0) {
    throw httpError(403, 'Not in classroom');
  }
  const result = await pool.query(
    `DELETE FROM classroom_enrollments
     WHERE classroom_id = $1 AND student_id = $2
     RETURNING classroom_id`,
    [classroomId, studentId],
  );
  if (result.rows.length === 0) {
    throw httpError(404, 'Student not found in classroom');
  }
}

export async function getClassroomStudentStats(classroomId, studentId, actorTeacherId) {
  const relationship = await pool.query(
    `SELECT 1
     FROM classroom_teachers ct
     JOIN classroom_enrollments ce ON ce.classroom_id = ct.classroom_id
     WHERE ct.classroom_id = $1
       AND ct.teacher_id = $2
       AND ce.student_id = $3`,
    [classroomId, actorTeacherId, studentId],
  );
  if (relationship.rows.length === 0) {
    throw httpError(403, 'Student is not in your classroom');
  }

  const studentResult = await pool.query(
    `SELECT id, username, display_name FROM users WHERE id = $1`,
    [studentId],
  );
  if (studentResult.rows.length === 0) {
    throw httpError(404, 'Student not found');
  }
  const student = studentResult.rows[0];

  const wordsResult = await pool.query(
    `SELECT id, word, translation, part_of_speech, srs_interval, due_at,
            last_reviewed_at, correct_count, incorrect_count, learning_step, created_at
     FROM saved_words
     WHERE user_id = $1
       AND target_language = (SELECT target_language FROM users WHERE id = $1)
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
  const wordsMastered = words.filter((w) => w.srs_interval >= 21).length;
  const totalCorrect = words.reduce((sum, w) => sum + (w.correct_count || 0), 0);
  const totalIncorrect = words.reduce((sum, w) => sum + (w.incorrect_count || 0), 0);
  const totalReviews = totalCorrect + totalIncorrect;
  const accuracy = totalReviews > 0 ? totalCorrect / totalReviews : null;
  const reviewDates = words.map((w) => w.last_reviewed_at).filter(Boolean);
  const lastReviewedAt = reviewDates.length > 0
    ? reviewDates.reduce((latest, date) => (new Date(date) > new Date(latest) ? date : latest))
    : null;

  // Days active this week (distinct dates with reviews in last 7 days)
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const activeDates = new Set();
  for (const w of words) {
    if (w.last_reviewed_at && new Date(w.last_reviewed_at) >= weekAgo) {
      activeDates.add(new Date(w.last_reviewed_at).toISOString().slice(0, 10));
    }
  }
  const daysActiveThisWeek = activeDates.size;

  // Daily activity for the last 90 days (reviews, words added, quizzes, drills, voice practice)
  const activityResult = await pool.query(
    `WITH review_days AS (
       SELECT last_reviewed_at::date AS day,
              COUNT(*) AS reviews,
              SUM(correct_count) AS correct,
              SUM(incorrect_count) AS incorrect
       FROM saved_words
       WHERE user_id = $1 AND last_reviewed_at IS NOT NULL
         AND last_reviewed_at >= NOW() - INTERVAL '90 days'
       GROUP BY last_reviewed_at::date
     ),
     added_days AS (
       SELECT created_at::date AS day, COUNT(*) AS words_added
       FROM saved_words
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '90 days'
       GROUP BY created_at::date
     ),
     quiz_days AS (
       SELECT created_at::date AS day, COUNT(*) AS quizzes, SUM(correct_count) AS quiz_correct, SUM(question_count) AS quiz_total
       FROM quiz_sessions
       WHERE user_id = $1 AND completed_at IS NOT NULL AND created_at >= NOW() - INTERVAL '90 days'
       GROUP BY created_at::date
     ),
     drill_days AS (
       SELECT created_at::date AS day, COUNT(*) AS drills
       FROM drill_sessions
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '90 days'
       GROUP BY created_at::date
     ),
     voice_days AS (
       SELECT created_at::date AS day, COUNT(*) AS voice_sessions
       FROM voice_practice_sessions
       WHERE user_id = $1 AND completed_at IS NOT NULL AND created_at >= NOW() - INTERVAL '90 days'
       GROUP BY created_at::date
     ),
     all_days AS (
       SELECT day FROM review_days
       UNION SELECT day FROM added_days
       UNION SELECT day FROM quiz_days
       UNION SELECT day FROM drill_days
       UNION SELECT day FROM voice_days
     )
     SELECT d.day,
            COALESCE(r.reviews, 0)::int AS reviews,
            COALESCE(a.words_added, 0)::int AS words_added,
            COALESCE(q.quizzes, 0)::int AS quizzes,
            COALESCE(q.quiz_correct, 0)::int AS quiz_correct,
            COALESCE(q.quiz_total, 0)::int AS quiz_total,
            COALESCE(dr.drills, 0)::int AS drills,
            COALESCE(v.voice_sessions, 0)::int AS voice_sessions
     FROM all_days d
     LEFT JOIN review_days r ON r.day = d.day
     LEFT JOIN added_days a ON a.day = d.day
     LEFT JOIN quiz_days q ON q.day = d.day
     LEFT JOIN drill_days dr ON dr.day = d.day
     LEFT JOIN voice_days v ON v.day = d.day
     ORDER BY d.day ASC`,
    [studentId],
  );

  // Compute current streak (consecutive days ending today or yesterday)
  const activityDays = new Set(activityResult.rows.map((r) => r.day.toISOString().slice(0, 10)));
  let streak = 0;
  const streakStart = new Date(now);
  // Allow streak to start from today or yesterday
  if (!activityDays.has(streakStart.toISOString().slice(0, 10))) {
    streakStart.setDate(streakStart.getDate() - 1);
  }
  const d = new Date(streakStart);
  while (activityDays.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }

  // Word lists assigned to this classroom, with completion status for this student
  const wordListsResult = await pool.query(
    `SELECT sp.id, sp.title,
            COALESCE(wc.cnt, 0)::int AS word_count,
            swlc.completed_at IS NOT NULL AS completed,
            swlc.completed_at
     FROM stream_posts sp
     JOIN classroom_teachers ct ON ct.teacher_id = sp.teacher_id AND ct.classroom_id = $1
     LEFT JOIN (
       SELECT post_id, COUNT(*) AS cnt FROM stream_post_words GROUP BY post_id
     ) wc ON wc.post_id = sp.id
     LEFT JOIN stream_word_list_completions swlc
       ON swlc.post_id = sp.id AND swlc.student_id = $2
     WHERE sp.type = 'word_list'
     ORDER BY sp.created_at DESC`,
    [classroomId, studentId],
  );

  // Recent completed sessions (quizzes, drills, voice practice) — last 20
  const recentSessionsResult = await pool.query(
    `(SELECT 'quiz' AS type, id, question_count, correct_count,
             NULL::int AS duration_seconds, mode AS detail, completed_at AS done_at
      FROM quiz_sessions
      WHERE user_id = $1 AND completed_at IS NOT NULL
      ORDER BY completed_at DESC LIMIT 10)
     UNION ALL
     (SELECT 'drill' AS type, id, question_count, correct_count,
             duration_seconds, tense_key AS detail, created_at AS done_at
      FROM drill_sessions
      WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 10)
     UNION ALL
     (SELECT 'voice' AS type, id, prompt_count AS question_count, correct_count,
             duration_seconds, target_language AS detail, completed_at AS done_at
      FROM voice_practice_sessions
      WHERE user_id = $1 AND completed_at IS NOT NULL
      ORDER BY completed_at DESC LIMIT 10)
     ORDER BY done_at DESC
     LIMIT 20`,
    [studentId],
  );

  // Compute SRS stage per word
  function srsStage(word) {
    if (word.srs_interval === 0 && word.learning_step === null && !word.last_reviewed_at) return 'new';
    if (word.learning_step !== null) return 'learning';
    if (word.srs_interval >= 21) return 'mastered';
    return 'review';
  }

  return {
    student,
    stats: {
      totalWords,
      wordsLearned,
      wordsDue,
      wordsNew,
      wordsInLearning,
      wordsMastered,
      daysActiveThisWeek,
      totalReviews,
      accuracy,
      lastReviewedAt,
      streak,
    },
    activity: activityResult.rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      reviews: r.reviews,
      wordsAdded: r.words_added,
      quizzes: r.quizzes,
      quizCorrect: r.quiz_correct,
      quizTotal: r.quiz_total,
      drills: r.drills,
      voiceSessions: r.voice_sessions,
    })),
    recentSessions: recentSessionsResult.rows.map((s) => ({
      type: s.type,
      id: s.id,
      questionCount: s.question_count,
      correctCount: s.correct_count,
      durationSeconds: s.duration_seconds,
      detail: s.detail,
      doneAt: s.done_at,
    })),
    wordLists: wordListsResult.rows.map((wl) => ({
      id: wl.id,
      title: wl.title,
      word_count: wl.word_count,
      completed: wl.completed,
      completed_at: wl.completed_at,
    })),
    words: words.map((word) => ({
      id: word.id,
      word: word.word,
      translation: word.translation,
      part_of_speech: word.part_of_speech,
      srs_stage: srsStage(word),
    })),
  };
}

export async function getLegacyStreamContext(classroomId, userId) {
  if (!classroomId) return null;
  const classroom = await getClassroomForUser(classroomId, userId);
  if (!classroom) {
    throw httpError(404, 'Classroom not found');
  }
  if (!classroom.is_default_migrated) {
    return { classroom, legacyTeacherId: null };
  }
  const { rows } = await pool.query(
    `SELECT teacher_id
     FROM classroom_teachers
     WHERE classroom_id = $1
     ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`,
    [classroomId],
  );
  return {
    classroom,
    legacyTeacherId: rows[0]?.teacher_id || null,
  };
}

export async function listLegacyTeacherIdsForStudent(studentId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ct.teacher_id
     FROM classroom_enrollments ce
     JOIN classroom_teachers ct ON ct.classroom_id = ce.classroom_id
     JOIN classrooms c ON c.id = ce.classroom_id
     WHERE ce.student_id = $1
       AND c.is_default_migrated = true
       AND c.archived_at IS NULL`,
    [studentId],
  );
  return rows.map((row) => row.teacher_id);
}

export async function ensureStudentHasLegacyPostAccess(postId, studentId) {
  const { rows } = await pool.query(
    `SELECT sp.*, c.id AS classroom_id
     FROM stream_posts sp
     JOIN classroom_teachers ct ON ct.teacher_id = sp.teacher_id
     JOIN classrooms c ON c.id = ct.classroom_id
     JOIN classroom_enrollments ce ON ce.classroom_id = c.id
     WHERE sp.id = $1
       AND ce.student_id = $2
       AND c.is_default_migrated = true
       AND c.archived_at IS NULL
     LIMIT 1`,
    [postId, studentId],
  );
  return rows[0] || null;
}
