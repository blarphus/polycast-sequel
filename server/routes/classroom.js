import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, requireTeacher } from '../auth.js';
import { validate } from '../lib/validate.js';
import {
  addStudentToClassroom,
  createClassroom,
  createClassroomTopic,
  deleteClassroom,
  getActiveCompatibleClassroomForTeacher,
  getClassroomForUser,
  getClassroomStudentStats,
  getClassroomTopics,
  listClassroomStudents,
  listVisibleClassrooms,
  removeStudentFromClassroom,
  updateClassroom,
} from '../services/classroomService.js';

const router = Router();

const classroomIdParam = z.object({ id: z.string().uuid('Invalid classroom ID') });
const studentIdParam = z.object({ studentId: z.string().uuid('Invalid student ID') });
const addStudentBody = z.object({ studentId: z.string().uuid('Invalid student ID') });
const createClassroomBody = z.object({
  name: z.string().min(1, 'Class name is required').trim(),
  section: z.string().trim().optional().or(z.literal('')),
  subject: z.string().trim().optional().or(z.literal('')),
  room: z.string().trim().optional().or(z.literal('')),
});
const updateClassroomBody = z.object({
  name: z.string().trim().optional(),
  section: z.string().trim().optional().nullable(),
  subject: z.string().trim().optional().nullable(),
  room: z.string().trim().optional().nullable(),
  needs_setup: z.boolean().optional(),
});
const createTopicBody = z.object({
  title: z.string().min(1, 'Topic title is required').trim(),
});
const legacyClassroomQuery = z.object({
  classroomId: z.string().uuid('Invalid classroom ID').optional(),
});

function normalizeOptionalText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function resolveTeacherClassroomOrThrow(req, res) {
  const classroomId = req.query.classroomId;
  if (classroomId) {
    const classroom = await getClassroomForUser(classroomId, req.userId);
    if (!classroom || classroom.role === 'student') {
      return res.status(403).json({ error: 'Not in classroom' });
    }
    return classroom;
  }

  const fallback = await getActiveCompatibleClassroomForTeacher(req.userId);
  if (!fallback) {
    return res.status(404).json({ error: 'No classroom found' });
  }
  const classroom = await getClassroomForUser(fallback.id, req.userId);
  if (!classroom) {
    return res.status(403).json({ error: 'Not in classroom' });
  }
  return classroom;
}

router.get('/api/classrooms', authMiddleware, async (req, res) => {
  try {
    const classrooms = await listVisibleClassrooms(req.userId);
    return res.json(classrooms);
  } catch (err) {
    req.log.error({ err }, 'GET /api/classrooms error');
    return res.status(500).json({ error: err.message || 'Failed to load classrooms' });
  }
});

router.post('/api/classrooms', authMiddleware, requireTeacher, validate({ body: createClassroomBody }), async (req, res) => {
  try {
    const classroom = await createClassroom({
      teacherId: req.userId,
      name: req.body.name.trim(),
      section: normalizeOptionalText(req.body.section),
      subject: normalizeOptionalText(req.body.subject),
      room: normalizeOptionalText(req.body.room),
    });
    return res.status(201).json(classroom);
  } catch (err) {
    req.log.error({ err }, 'POST /api/classrooms error');
    return res.status(500).json({ error: err.message || 'Failed to create classroom' });
  }
});

router.get('/api/classrooms/:id', authMiddleware, validate({ params: classroomIdParam }), async (req, res) => {
  try {
    const classroom = await getClassroomForUser(req.params.id, req.userId);
    if (!classroom) {
      return res.status(404).json({ error: 'Classroom not found' });
    }
    return res.json(classroom);
  } catch (err) {
    req.log.error({ err }, 'GET /api/classrooms/:id error');
    return res.status(500).json({ error: err.message || 'Failed to load classroom' });
  }
});

router.patch('/api/classrooms/:id', authMiddleware, validate({ params: classroomIdParam, body: updateClassroomBody }), async (req, res) => {
  try {
    const classroom = await updateClassroom({
      classroomId: req.params.id,
      teacherId: req.userId,
      patch: {
        ...(req.body.name !== undefined ? { name: req.body.name.trim() } : {}),
        ...(req.body.section !== undefined ? { section: normalizeOptionalText(req.body.section) } : {}),
        ...(req.body.subject !== undefined ? { subject: normalizeOptionalText(req.body.subject) } : {}),
        ...(req.body.room !== undefined ? { room: normalizeOptionalText(req.body.room) } : {}),
        ...(req.body.needs_setup !== undefined ? { needs_setup: req.body.needs_setup } : {}),
      },
    });
    return res.json(classroom);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    req.log.error({ err }, 'PATCH /api/classrooms/:id error');
    return res.status(500).json({ error: err.message || 'Failed to update classroom' });
  }
});

router.delete('/api/classrooms/:id', authMiddleware, requireTeacher, validate({ params: classroomIdParam }), async (req, res) => {
  try {
    await deleteClassroom(req.params.id, req.userId);
    return res.status(204).end();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    req.log.error({ err }, 'DELETE /api/classrooms/:id error');
    return res.status(500).json({ error: err.message || 'Failed to delete classroom' });
  }
});

router.get('/api/classrooms/:id/topics', authMiddleware, validate({ params: classroomIdParam }), async (req, res) => {
  try {
    const classroom = await getClassroomForUser(req.params.id, req.userId);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });
    const topics = await getClassroomTopics(req.params.id);
    return res.json(topics);
  } catch (err) {
    req.log.error({ err }, 'GET /api/classrooms/:id/topics error');
    return res.status(500).json({ error: err.message || 'Failed to load classroom topics' });
  }
});

router.post('/api/classrooms/:id/topics', authMiddleware, validate({ params: classroomIdParam, body: createTopicBody }), async (req, res) => {
  try {
    const classroom = await getClassroomForUser(req.params.id, req.userId);
    if (!classroom || classroom.role === 'student') {
      return res.status(403).json({ error: 'Not in classroom' });
    }
    const topic = await createClassroomTopic(req.params.id, req.body.title.trim());
    return res.status(201).json(topic);
  } catch (err) {
    req.log.error({ err }, 'POST /api/classrooms/:id/topics error');
    return res.status(500).json({ error: err.message || 'Failed to create classroom topic' });
  }
});

router.get('/api/classrooms/:id/students', authMiddleware, validate({ params: classroomIdParam }), async (req, res) => {
  try {
    const classroom = await getClassroomForUser(req.params.id, req.userId);
    if (!classroom || classroom.role === 'student') {
      return res.status(403).json({ error: 'Not in classroom' });
    }
    const students = await listClassroomStudents(req.params.id);
    return res.json(students);
  } catch (err) {
    req.log.error({ err }, 'GET /api/classrooms/:id/students error');
    return res.status(500).json({ error: err.message || 'Failed to load classroom students' });
  }
});

router.post('/api/classrooms/:id/students', authMiddleware, validate({ params: classroomIdParam, body: addStudentBody }), async (req, res) => {
  try {
    const result = await addStudentToClassroom(req.params.id, req.body.studentId, req.userId);
    return res.status(201).json(result);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Student already in classroom' });
    if (err.status) return res.status(err.status).json({ error: err.message });
    req.log.error({ err }, 'POST /api/classrooms/:id/students error');
    return res.status(500).json({ error: err.message || 'Failed to add classroom student' });
  }
});

router.delete('/api/classrooms/:id/students/:studentId', authMiddleware, validate({ params: classroomIdParam.merge(studentIdParam) }), async (req, res) => {
  try {
    await removeStudentFromClassroom(req.params.id, req.params.studentId, req.userId);
    return res.status(204).end();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    req.log.error({ err }, 'DELETE /api/classrooms/:id/students/:studentId error');
    return res.status(500).json({ error: err.message || 'Failed to remove classroom student' });
  }
});

router.get('/api/classrooms/:id/students/:studentId/stats', authMiddleware, validate({ params: classroomIdParam.merge(studentIdParam) }), async (req, res) => {
  try {
    const data = await getClassroomStudentStats(req.params.id, req.params.studentId, req.userId);
    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    req.log.error({ err }, 'GET /api/classrooms/:id/students/:studentId/stats error');
    return res.status(500).json({ error: err.message || 'Failed to load student stats' });
  }
});

/**
 * Compatibility endpoints for the existing teacher-wide classroom UI.
 */
router.get('/api/classroom/students', authMiddleware, requireTeacher, validate({ query: legacyClassroomQuery }), async (req, res) => {
  try {
    const classroom = await resolveTeacherClassroomOrThrow(req, res);
    if (!classroom || res.headersSent) return;
    const students = await listClassroomStudents(classroom.id);
    return res.json(students);
  } catch (err) {
    req.log.error({ err }, 'GET /api/classroom/students error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/classroom/students', authMiddleware, requireTeacher, validate({ query: legacyClassroomQuery, body: addStudentBody }), async (req, res) => {
  try {
    const classroom = await resolveTeacherClassroomOrThrow(req, res);
    if (!classroom || res.headersSent) return;
    const result = await addStudentToClassroom(classroom.id, req.body.studentId, req.userId);
    return res.status(201).json(result);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Student already in classroom' });
    if (err.status) return res.status(err.status).json({ error: err.message });
    req.log.error({ err }, 'POST /api/classroom/students error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/classroom/students/:studentId', authMiddleware, validate({ params: studentIdParam, query: legacyClassroomQuery }), async (req, res) => {
  try {
    const classroom = await resolveTeacherClassroomOrThrow(req, res);
    if (!classroom || res.headersSent) return;
    await removeStudentFromClassroom(classroom.id, req.params.studentId, req.userId);
    return res.status(204).end();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    req.log.error({ err }, 'DELETE /api/classroom/students/:studentId error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/classroom/students/:studentId/stats', authMiddleware, validate({ params: studentIdParam, query: legacyClassroomQuery }), async (req, res) => {
  try {
    const classroom = await resolveTeacherClassroomOrThrow(req, res);
    if (!classroom || res.headersSent) return;
    const data = await getClassroomStudentStats(classroom.id, req.params.studentId, req.userId);
    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    req.log.error({ err }, 'GET /api/classroom/students/:studentId/stats error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
