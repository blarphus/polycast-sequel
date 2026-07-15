import test from 'node:test';
import assert from 'node:assert/strict';
import { joinClassroomByCode } from '../services/classroomService.js';

function classroomDatabase({ classroomId = 'class-1', inserted = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      if (/FROM classrooms/.test(text)) return { rows: classroomId ? [{ id: classroomId }] : [] };
      if (/INSERT INTO classroom_enrollments/.test(text)) {
        return { rows: inserted ? [{ classroom_id: classroomId }] : [], rowCount: inserted ? 1 : 0 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

test('student joins an active classroom using a normalized code', async () => {
  const db = classroomDatabase();
  const result = await joinClassroomByCode('student-1', ' A1B2C3D4 ', {
    db,
    getAccountType: async () => 'student',
    getClassroom: async (id) => ({ id, name: 'Spanish 101' }),
  });

  assert.equal(result.joined, true);
  assert.equal(result.classroom.id, 'class-1');
  assert.deepEqual(db.calls[0].values, ['a1b2c3d4']);
  assert.deepEqual(db.calls[1].values, ['class-1', 'student-1']);
  assert.match(db.calls[1].text, /ON CONFLICT .* DO NOTHING/);
});

test('joining an existing enrollment is idempotent', async () => {
  const result = await joinClassroomByCode('student-1', 'a1b2c3d4', {
    db: classroomDatabase({ inserted: false }),
    getAccountType: async () => 'student',
    getClassroom: async (id) => ({ id, name: 'Spanish 101' }),
  });
  assert.equal(result.joined, false);
});

test('unknown class code returns a typed not-found error', async () => {
  await assert.rejects(
    joinClassroomByCode('student-1', 'missing1', {
      db: classroomDatabase({ classroomId: null }),
      getAccountType: async () => 'student',
    }),
    (error) => error.status === 404 && error.code === 'classroom_code_not_found',
  );
});

test('teacher accounts cannot self-enroll through a class code', async () => {
  const db = classroomDatabase();
  await assert.rejects(
    joinClassroomByCode('teacher-1', 'a1b2c3d4', {
      db,
      getAccountType: async () => 'teacher',
    }),
    (error) => error.status === 403 && error.code === 'classroom_student_account_required',
  );
  assert.equal(db.calls.length, 0);
});
