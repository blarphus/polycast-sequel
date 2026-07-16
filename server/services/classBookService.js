import crypto from 'node:crypto';
import pool from '../db.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/httpErrors.js';
import { getClassroomForUser } from './classroomService.js';
import {
  createStorageKey,
  isPdfDocument,
  isZipArchive,
  promoteClassBookUpload,
  removeStoredClassBook,
  removeTemporaryClassBook,
  storedBookPath,
} from './classBookStorage.js';

function mapClassBook(row) {
  return {
    id: row.id,
    classroom_id: row.classroom_id,
    classroom_name: row.classroom_name,
    title: row.title,
    author: row.author,
    original_filename: row.original_filename,
    format: row.format,
    mime_type: row.mime_type,
    byte_size: Number(row.byte_size),
    language: row.language,
    created_at: row.created_at,
    access_role: row.access_role || null,
  };
}

async function requireTeacherClassroom(classroomId, userId, getClassroom = getClassroomForUser) {
  const classroom = await getClassroom(classroomId, userId);
  if (!classroom) {
    throw new NotFoundError('Classroom not found', { code: 'classroom_not_found' });
  }
  if (classroom.role === 'student') {
    throw new ForbiddenError('Teacher access is required to manage class books', {
      code: 'class_book_teacher_access_required',
    });
  }
  return classroom;
}

export async function listAccessibleClassBooks(userId, { db = pool } = {}) {
  const { rows } = await db.query(
    `SELECT cb.*, c.name AS classroom_name,
            CASE WHEN ct.teacher_id IS NOT NULL THEN 'teacher' ELSE 'student' END AS access_role
     FROM classroom_books cb
     JOIN classrooms c ON c.id = cb.classroom_id AND c.archived_at IS NULL
     LEFT JOIN classroom_teachers ct
       ON ct.classroom_id = cb.classroom_id AND ct.teacher_id = $1
     LEFT JOIN classroom_enrollments ce
       ON ce.classroom_id = cb.classroom_id AND ce.student_id = $1
     WHERE (ct.teacher_id IS NOT NULL OR ce.student_id IS NOT NULL)
       AND cb.format IN ('epub', 'cbz')
     ORDER BY cb.created_at DESC`,
    [userId],
  );
  return rows.map(mapClassBook);
}

export async function listClassroomBooks(classroomId, userId, {
  db = pool,
  getClassroom = getClassroomForUser,
} = {}) {
  const classroom = await getClassroom(classroomId, userId);
  if (!classroom) throw new NotFoundError('Classroom not found', { code: 'classroom_not_found' });
  const { rows } = await db.query(
    `SELECT cb.*, $2::text AS classroom_name, $3::text AS access_role
     FROM classroom_books cb
     WHERE cb.classroom_id = $1
     ORDER BY cb.created_at DESC`,
    [classroomId, classroom.name, classroom.role],
  );
  return rows.map(mapClassBook);
}

export async function addClassroomBook({
  classroomId,
  teacherId,
  file,
  title,
  author,
  language,
}, {
  db = pool,
  getClassroom = getClassroomForUser,
  promoteUpload = promoteClassBookUpload,
  removeStored = removeStoredClassBook,
  inspectZip = isZipArchive,
  inspectPdf = isPdfDocument,
} = {}) {
  const classroom = await requireTeacherClassroom(classroomId, teacherId, getClassroom);
  if (!file?.path || !file?.originalname || !file?.size) {
    throw new ValidationError([{ path: 'body.book', message: 'Choose a PDF, EPUB, or CBZ file' }]);
  }

  const extension = file.originalname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension !== 'epub' && extension !== 'cbz' && extension !== 'pdf') {
    throw new ValidationError([{ path: 'body.book', message: 'Only EPUB, CBZ, and PDF files are supported' }]);
  }
  if (extension === 'cbz' && language !== 'en' && language !== 'es') {
    throw new ValidationError([{ path: 'body.language', message: 'Choose English or Spanish for CBZ text recognition' }]);
  }
  if ((extension === 'epub' || extension === 'cbz') && !await inspectZip(file.path)) {
    throw new ValidationError([{ path: 'body.book', message: 'The uploaded file is not a valid ZIP-based EPUB or CBZ archive' }]);
  }
  if (extension === 'pdf' && !await inspectPdf(file.path)) {
    throw new ValidationError([{ path: 'body.book', message: 'The uploaded file is not a valid PDF document' }]);
  }

  const id = crypto.randomUUID();
  const storageKey = createStorageKey(id, extension);
  let promoted = false;
  try {
    await promoteUpload(file.path, storageKey);
    promoted = true;
    const mimeType = extension === 'epub'
      ? 'application/epub+zip'
      : extension === 'cbz'
        ? 'application/vnd.comicbook+zip'
        : 'application/pdf';
    const { rows } = await db.query(
      `INSERT INTO classroom_books (
         id, classroom_id, uploaded_by, title, author, original_filename,
         format, mime_type, byte_size, storage_key, language
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *, $12::text AS classroom_name, 'teacher'::text AS access_role`,
      [
        id,
        classroomId,
        teacherId,
        title.trim(),
        author?.trim() || null,
        file.originalname,
        extension,
        mimeType,
        file.size,
        storageKey,
        language || null,
        classroom.name,
      ],
    );
    return mapClassBook(rows[0]);
  } catch (error) {
    if (promoted) await removeStored(storageKey, { ignoreMissing: true });
    else await removeTemporaryClassBook(file.path);
    throw error;
  }
}

export async function getAccessibleClassBook(bookId, userId, { db = pool } = {}) {
  const { rows } = await db.query(
    `SELECT cb.*, c.name AS classroom_name,
            CASE WHEN ct.teacher_id IS NOT NULL THEN 'teacher' ELSE 'student' END AS access_role
     FROM classroom_books cb
     JOIN classrooms c ON c.id = cb.classroom_id AND c.archived_at IS NULL
     LEFT JOIN classroom_teachers ct
       ON ct.classroom_id = cb.classroom_id AND ct.teacher_id = $2
     LEFT JOIN classroom_enrollments ce
       ON ce.classroom_id = cb.classroom_id AND ce.student_id = $2
     WHERE cb.id = $1
       AND (ct.teacher_id IS NOT NULL OR ce.student_id IS NOT NULL)
     LIMIT 1`,
    [bookId, userId],
  );
  if (!rows[0]) throw new NotFoundError('Class book not found', { code: 'class_book_not_found' });
  return { ...mapClassBook(rows[0]), storage_path: storedBookPath(rows[0].storage_key) };
}

export async function deleteClassroomBook(bookId, userId, {
  db = pool,
  getClassroom = getClassroomForUser,
  removeStored = removeStoredClassBook,
} = {}) {
  const existing = await db.query(
    `SELECT id, classroom_id, storage_key
     FROM classroom_books
     WHERE id = $1
     LIMIT 1`,
    [bookId],
  );
  const book = existing.rows[0];
  if (!book) throw new NotFoundError('Class book not found', { code: 'class_book_not_found' });
  await requireTeacherClassroom(book.classroom_id, userId, getClassroom);
  await db.query('DELETE FROM classroom_books WHERE id = $1', [bookId]);
  await removeStored(book.storage_key, { ignoreMissing: true });
}
