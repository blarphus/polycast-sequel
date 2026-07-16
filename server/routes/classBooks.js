import path from 'node:path';
import multer from 'multer';
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import { asyncHandler, HttpError, ValidationError } from '../lib/httpErrors.js';
import { validate } from '../lib/validate.js';
import {
  addClassroomBook,
  deleteClassroomBook,
  getAccessibleClassBook,
  listAccessibleClassBooks,
  listClassroomBooks,
} from '../services/classBookService.js';
import {
  createTemporaryUploadName,
  ensureClassBookStorage,
  MAX_CLASS_BOOK_BYTES,
  removeTemporaryClassBook,
} from '../services/classBookStorage.js';

const router = Router();
const uuidParam = z.object({ id: z.string().uuid('Invalid ID') });
const uploadFields = z.object({
  title: z.string().trim().min(1, 'Book title is required').max(300, 'Book title is too long'),
  author: z.string().trim().max(300, 'Author is too long').optional().or(z.literal('')),
  language: z.enum(['en', 'es']).optional().or(z.literal('')),
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      ensureClassBookStorage().then(({ temporary }) => callback(null, temporary), callback);
    },
    filename: (_req, _file, callback) => callback(null, createTemporaryUploadName()),
  }),
  limits: { fileSize: MAX_CLASS_BOOK_BYTES, files: 1, fields: 4 },
});

function parseBookUpload(req, res, next) {
  upload.single('book')(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return next(new HttpError(413, 'Class books can be up to 1 GB', {
        code: 'class_book_too_large',
        expose: true,
      }));
    }
    return next(new ValidationError([{ path: 'body.book', message: error.message || 'Book upload failed' }]));
  });
}

async function validateBookUpload(req, _res, next) {
  const parsed = uploadFields.safeParse(req.body);
  if (parsed.success) {
    req.body = parsed.data;
    return next();
  }
  await removeTemporaryClassBook(req.file?.path);
  return next(new ValidationError(parsed.error.issues.map((issue) => ({
    path: `body.${issue.path.join('.')}`,
    message: issue.message,
  }))));
}

router.get('/api/class-books', authMiddleware, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json(await listAccessibleClassBooks(req.userId));
}));

router.get('/api/classrooms/:id/books', authMiddleware, validate({ params: uuidParam }), asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json(await listClassroomBooks(req.params.id, req.userId));
}));

router.post(
  '/api/classrooms/:id/books',
  authMiddleware,
  validate({ params: uuidParam }),
  parseBookUpload,
  validateBookUpload,
  asyncHandler(async (req, res) => {
    try {
      const book = await addClassroomBook({
        classroomId: req.params.id,
        teacherId: req.userId,
        file: req.file,
        title: req.body.title,
        author: req.body.author,
        language: req.body.language,
      });
      return res.status(201).json(book);
    } catch (error) {
      await removeTemporaryClassBook(req.file?.path);
      throw error;
    }
  }),
);

router.get('/api/class-books/:id/file', authMiddleware, validate({ params: uuidParam }), asyncHandler(async (req, res, next) => {
  const book = await getAccessibleClassBook(req.params.id, req.userId);
  res.setHeader('Content-Type', book.mime_type);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(book.original_filename))}`);
  return res.sendFile(book.storage_path, (error) => {
    if (error) next(error);
  });
}));

router.delete('/api/class-books/:id', authMiddleware, validate({ params: uuidParam }), asyncHandler(async (req, res) => {
  await deleteClassroomBook(req.params.id, req.userId);
  return res.status(204).end();
}));

export default router;
