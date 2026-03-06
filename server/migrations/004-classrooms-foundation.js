/**
 * 004-classrooms-foundation — real classroom ownership model and legacy backfill.
 */

import { generateUniqueClassIdentity } from '../lib/classroomIdentity.js';

function buildDefaultClassroomName(user) {
  const base = (user.display_name || user.username || 'Teacher').trim();
  return `${base}'s Classroom`;
}

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS classrooms (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                TEXT NOT NULL,
      section             TEXT,
      subject             TEXT,
      room                TEXT,
      class_code          VARCHAR(12) NOT NULL UNIQUE,
      invite_token        TEXT NOT NULL UNIQUE,
      created_by          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_default_migrated BOOLEAN NOT NULL DEFAULT false,
      needs_setup         BOOLEAN NOT NULL DEFAULT false,
      archived_at         TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS classroom_teachers (
      classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      teacher_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role         VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'co_teacher')),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (classroom_id, teacher_id)
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_classroom_teachers_teacher
      ON classroom_teachers (teacher_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS classroom_enrollments (
      classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      student_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (classroom_id, student_id)
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_classroom_enrollments_student
      ON classroom_enrollments (student_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS classroom_topics (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      position     INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_classroom_topics_classroom_position
      ON classroom_topics (classroom_id, position);
  `);

  const { rows: legacyTeachers } = await client.query(`
    SELECT DISTINCT u.id, u.username, u.display_name
    FROM users u
    WHERE u.account_type = 'teacher'
      AND (
        EXISTS (SELECT 1 FROM classroom_students cs WHERE cs.teacher_id = u.id)
        OR EXISTS (SELECT 1 FROM stream_topics st WHERE st.teacher_id = u.id)
        OR EXISTS (SELECT 1 FROM stream_posts sp WHERE sp.teacher_id = u.id)
      )
  `);

  for (const teacher of legacyTeachers) {
    let classroomId;
    const { rows: existing } = await client.query(
      `SELECT id
       FROM classrooms
       WHERE created_by = $1
         AND is_default_migrated = true
       LIMIT 1`,
      [teacher.id],
    );

    if (existing.length > 0) {
      classroomId = existing[0].id;
    } else {
      const { classCode, inviteToken } = await generateUniqueClassIdentity(client);
      const { rows: classroomRows } = await client.query(
        `INSERT INTO classrooms (
           name, class_code, invite_token, created_by, is_default_migrated, needs_setup
         )
         VALUES ($1, $2, $3, $4, true, true)
         RETURNING id`,
        [buildDefaultClassroomName(teacher), classCode, inviteToken, teacher.id],
      );
      classroomId = classroomRows[0].id;
      await client.query(
        `INSERT INTO classroom_teachers (classroom_id, teacher_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (classroom_id, teacher_id) DO NOTHING`,
        [classroomId, teacher.id],
      );
    }

    await client.query(
      `INSERT INTO classroom_enrollments (classroom_id, student_id, created_at)
       SELECT $1, cs.student_id, cs.created_at
       FROM classroom_students cs
       WHERE cs.teacher_id = $2
       ON CONFLICT (classroom_id, student_id) DO NOTHING`,
      [classroomId, teacher.id],
    );

    await client.query(
      `INSERT INTO classroom_topics (title, position, created_at, classroom_id)
       SELECT st.title, st.position, st.created_at, $1
       FROM stream_topics st
       WHERE st.teacher_id = $2
       ORDER BY st.position ASC, st.created_at ASC`,
      [classroomId, teacher.id],
    );
  }
}
