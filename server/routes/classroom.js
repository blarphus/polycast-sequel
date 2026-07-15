import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, requireTeacher } from '../auth.js';
import { validate } from '../lib/validate.js';
import { asyncHandler, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/httpErrors.js';
import {
  addStudentToClassroom,
  createClassroom,
  createClassroomTopic,
  deleteClassroom,
  getClassroomForUser,
  getClassroomStudentStats,
  getClassroomTopics,
  joinClassroomByCode,
  listClassroomStudents,
  listVisibleClassrooms,
  removeStudentFromClassroom,
  updateClassroom,
} from '../services/classroomService.js';
import { supportedLanguageSchema } from '../lib/languagePolicy.js';

const router = Router();

const classroomIdParam = z.object({ id: z.string().uuid('Invalid classroom ID') });
const studentIdParam = z.object({ studentId: z.string().uuid('Invalid student ID') });
const addStudentBody = z.object({ studentId: z.string().uuid('Invalid student ID') });
const joinClassroomBody = z.object({
  classCode: z.string()
    .trim()
    .min(6, 'Class code is too short')
    .max(12, 'Class code is too long')
    .regex(/^[a-z0-9]+$/i, 'Class code can contain only letters and numbers'),
});
const createClassroomBody = z.object({
  name: z.string().min(1, 'Class name is required').trim(),
  section: z.string().trim().optional().or(z.literal('')),
  subject: z.string().trim().optional().or(z.literal('')),
  room: z.string().trim().optional().or(z.literal('')),
  target_language: supportedLanguageSchema.optional().or(z.literal('')),
  native_language: supportedLanguageSchema.optional().or(z.literal('')),
});
const updateClassroomBody = z.object({
  name: z.string().trim().optional(),
  section: z.string().trim().optional().nullable(),
  subject: z.string().trim().optional().nullable(),
  room: z.string().trim().optional().nullable(),
  target_language: supportedLanguageSchema.optional().nullable(),
  native_language: supportedLanguageSchema.optional().nullable(),
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
  return trimmed || null;
}

async function resolveTeacherClassroomOrThrow(userId, classroomId) {
  if (!classroomId) {
    throw new ValidationError([{ path: 'query.classroomId', message: 'classroomId is required for legacy classroom endpoints' }]);
  }
  const classroom = await getClassroomForUser(classroomId, userId);
  if (!classroom || classroom.role === 'student') {
    throw new ForbiddenError('Not in classroom', { code: 'classroom_teacher_access_required' });
  }
  return classroom;
}

function classroomPatch(body) {
  return {
    ...(body.name !== undefined ? { name: body.name.trim() } : {}),
    ...(body.section !== undefined ? { section: normalizeOptionalText(body.section) } : {}),
    ...(body.subject !== undefined ? { subject: normalizeOptionalText(body.subject) } : {}),
    ...(body.room !== undefined ? { room: normalizeOptionalText(body.room) } : {}),
    ...(body.target_language !== undefined ? { target_language: normalizeOptionalText(body.target_language) } : {}),
    ...(body.native_language !== undefined ? { native_language: normalizeOptionalText(body.native_language) } : {}),
    ...(body.needs_setup !== undefined ? { needs_setup: body.needs_setup } : {}),
  };
}

async function translateUniqueStudentConflict(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error?.code === '23505') {
      throw new ConflictError('Student already in classroom', { code: 'classroom_student_already_added' });
    }
    throw error;
  }
}

router.get('/api/classrooms', authMiddleware, asyncHandler(async (req, res) => {
  return res.json(await listVisibleClassrooms(req.userId));
}));

router.post('/api/classrooms', authMiddleware, requireTeacher, validate({ body: createClassroomBody }), asyncHandler(async (req, res) => {
  return res.status(201).json(await createClassroom({
    teacherId: req.userId,
    name: req.body.name.trim(),
    section: normalizeOptionalText(req.body.section),
    subject: normalizeOptionalText(req.body.subject),
    room: normalizeOptionalText(req.body.room),
    target_language: normalizeOptionalText(req.body.target_language),
    native_language: normalizeOptionalText(req.body.native_language),
  }));
}));

router.post('/api/classrooms/join', authMiddleware, validate({ body: joinClassroomBody }), asyncHandler(async (req, res) => {
  const result = await joinClassroomByCode(req.userId, req.body.classCode);
  return res.status(result.joined ? 201 : 200).json(result);
}));

router.get('/api/classrooms/:id', authMiddleware, validate({ params: classroomIdParam }), asyncHandler(async (req, res) => {
  const classroom = await getClassroomForUser(req.params.id, req.userId);
  if (!classroom) throw new NotFoundError('Classroom not found', { code: 'classroom_not_found' });
  return res.json(classroom);
}));

router.patch('/api/classrooms/:id', authMiddleware, validate({ params: classroomIdParam, body: updateClassroomBody }), asyncHandler(async (req, res) => {
  return res.json(await updateClassroom({
    classroomId: req.params.id,
    teacherId: req.userId,
    patch: classroomPatch(req.body),
  }));
}));

router.delete('/api/classrooms/:id', authMiddleware, requireTeacher, validate({ params: classroomIdParam }), asyncHandler(async (req, res) => {
  await deleteClassroom(req.params.id, req.userId);
  return res.status(204).end();
}));

router.get('/api/classrooms/:id/topics', authMiddleware, validate({ params: classroomIdParam }), asyncHandler(async (req, res) => {
  const classroom = await getClassroomForUser(req.params.id, req.userId);
  if (!classroom) throw new NotFoundError('Classroom not found', { code: 'classroom_not_found' });
  return res.json(await getClassroomTopics(req.params.id));
}));

router.post('/api/classrooms/:id/topics', authMiddleware, validate({ params: classroomIdParam, body: createTopicBody }), asyncHandler(async (req, res) => {
  await resolveTeacherClassroomOrThrow(req.userId, req.params.id);
  return res.status(201).json(await createClassroomTopic(req.params.id, req.body.title.trim()));
}));

router.get('/api/classrooms/:id/students', authMiddleware, validate({ params: classroomIdParam }), asyncHandler(async (req, res) => {
  await resolveTeacherClassroomOrThrow(req.userId, req.params.id);
  return res.json(await listClassroomStudents(req.params.id));
}));

router.post('/api/classrooms/:id/students', authMiddleware, validate({ params: classroomIdParam, body: addStudentBody }), asyncHandler(async (req, res) => {
  return res.status(201).json(await translateUniqueStudentConflict(
    () => addStudentToClassroom(req.params.id, req.body.studentId, req.userId),
  ));
}));

router.delete('/api/classrooms/:id/students/:studentId', authMiddleware, validate({ params: classroomIdParam.merge(studentIdParam) }), asyncHandler(async (req, res) => {
  await removeStudentFromClassroom(req.params.id, req.params.studentId, req.userId);
  return res.status(204).end();
}));

router.get('/api/classrooms/:id/students/:studentId/stats', authMiddleware, validate({ params: classroomIdParam.merge(studentIdParam) }), asyncHandler(async (req, res) => {
  return res.json(await getClassroomStudentStats(req.params.id, req.params.studentId, req.userId));
}));

router.get('/api/classroom/students', authMiddleware, requireTeacher, validate({ query: legacyClassroomQuery }), asyncHandler(async (req, res) => {
  const classroom = await resolveTeacherClassroomOrThrow(req.userId, req.query.classroomId);
  return res.json(await listClassroomStudents(classroom.id));
}));

router.post('/api/classroom/students', authMiddleware, requireTeacher, validate({ query: legacyClassroomQuery, body: addStudentBody }), asyncHandler(async (req, res) => {
  const classroom = await resolveTeacherClassroomOrThrow(req.userId, req.query.classroomId);
  return res.status(201).json(await translateUniqueStudentConflict(
    () => addStudentToClassroom(classroom.id, req.body.studentId, req.userId),
  ));
}));

router.delete('/api/classroom/students/:studentId', authMiddleware, requireTeacher, validate({ params: studentIdParam, query: legacyClassroomQuery }), asyncHandler(async (req, res) => {
  const classroom = await resolveTeacherClassroomOrThrow(req.userId, req.query.classroomId);
  await removeStudentFromClassroom(classroom.id, req.params.studentId, req.userId);
  return res.status(204).end();
}));

router.get('/api/classroom/students/:studentId/stats', authMiddleware, requireTeacher, validate({ params: studentIdParam, query: legacyClassroomQuery }), asyncHandler(async (req, res) => {
  const classroom = await resolveTeacherClassroomOrThrow(req.userId, req.query.classroomId);
  return res.json(await getClassroomStudentStats(classroom.id, req.params.studentId, req.userId));
}));

export default router;
