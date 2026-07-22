import path from 'node:path';
import multer from 'multer';
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import { asyncHandler, HttpError, ValidationError } from '../lib/httpErrors.js';
import { validate } from '../lib/validate.js';
import {
  addUserLibraryBook, deleteUserLibraryBook, getLibraryBookProgress,
  getUserLibraryBook, listUserLibraryBooks, setLibraryBookProgress,
} from '../services/userLibraryBookService.js';
import {
  createTemporaryUploadName, ensureClassBookStorage, MAX_CLASS_BOOK_BYTES, removeTemporaryClassBook,
} from '../services/classBookStorage.js';

const router = Router();
const uuidParam = z.object({ id: z.string().uuid('Invalid ID') });
const sourceQuery = z.object({ source: z.enum(['personal', 'class']) });
const progressBody = z.object({
  source: z.enum(['personal', 'class']), chapterIndex: z.number().int().min(0), pageIndex: z.number().int().min(0),
});
const uploadFields = z.object({
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(300).optional().or(z.literal('')),
  language: z.enum(['en', 'es']).optional().or(z.literal('')),
});
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      ensureClassBookStorage().then(({ temporary }) => callback(null, temporary), callback);
    },
    filename: (_req, _file, callback) => callback(null, createTemporaryUploadName()),
  }),
  limits: { fileSize: MAX_CLASS_BOOK_BYTES, files: 1, fields: 3 },
});

function parseUpload(req, res, next) {
  upload.single('book')(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return next(new HttpError(413, 'Books can be up to 1 GB', { code: 'library_book_too_large', expose: true }));
    }
    return next(new ValidationError([{ path: 'body.book', message: error.message || 'Book upload failed' }]));
  });
}

async function validateUpload(req, _res, next) {
  const parsed = uploadFields.safeParse(req.body);
  if (parsed.success) { req.body = parsed.data; return next(); }
  await removeTemporaryClassBook(req.file?.path);
  return next(new ValidationError(parsed.error.issues.map((issue) => ({
    path: `body.${issue.path.join('.')}`, message: issue.message,
  }))));
}

router.get('/api/library-books', authMiddleware, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json(await listUserLibraryBooks(req.userId));
}));

router.post('/api/library-books', authMiddleware, parseUpload, validateUpload, asyncHandler(async (req, res) => {
  try {
    return res.status(201).json(await addUserLibraryBook({
      userId: req.userId, file: req.file, title: req.body.title,
      author: req.body.author, language: req.body.language,
    }));
  } catch (error) {
    await removeTemporaryClassBook(req.file?.path);
    throw error;
  }
}));

router.get('/api/library-books/:id/file', authMiddleware, validate({ params: uuidParam }), asyncHandler(async (req, res, next) => {
  const book = await getUserLibraryBook(req.params.id, req.userId);
  res.setHeader('Content-Type', book.mime_type);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(book.original_filename))}`);
  return res.sendFile(book.storage_path, (error) => { if (error) next(error); });
}));

router.delete('/api/library-books/:id', authMiddleware, validate({ params: uuidParam }), asyncHandler(async (req, res) => {
  await deleteUserLibraryBook(req.params.id, req.userId);
  return res.status(204).end();
}));

router.get('/api/library-books/:id/progress', authMiddleware, validate({ params: uuidParam, query: sourceQuery }), asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json(await getLibraryBookProgress(req.params.id, req.query.source, req.userId));
}));

router.put('/api/library-books/:id/progress', authMiddleware, validate({ params: uuidParam, body: progressBody }), asyncHandler(async (req, res) => {
  return res.json(await setLibraryBookProgress(
    req.params.id, req.body.source, req.userId, req.body.chapterIndex, req.body.pageIndex,
  ));
}));

export default router;
