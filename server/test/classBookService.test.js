import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  addClassroomBook,
  deleteClassroomBook,
  listAccessibleClassBooks,
} from '../services/classBookService.js';
import { isPdfDocument, isZipArchive } from '../services/classBookStorage.js';

const classroom = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Spanish 2',
  role: 'owner',
};
const teacherId = '22222222-2222-4222-8222-222222222222';

test('teacher uploads a PDF once and persists class metadata after storage promotion', async () => {
  let promoted = null;
  const db = {
    async query(sql, values) {
      assert.match(sql, /INSERT INTO classroom_books/);
      return {
        rows: [{
          id: values[0],
          classroom_id: values[1],
          uploaded_by: values[2],
          title: values[3],
          author: values[4],
          original_filename: values[5],
          format: values[6],
          mime_type: values[7],
          byte_size: values[8],
          storage_key: values[9],
          language: values[10],
          classroom_name: values[11],
          access_role: 'teacher',
          created_at: new Date().toISOString(),
        }],
      };
    },
  };

  const result = await addClassroomBook({
    classroomId: classroom.id,
    teacherId,
    file: { path: '/tmp/upload', originalname: 'Reading Packet.pdf', size: 2048 },
    title: 'Reading Packet',
    author: '',
    language: 'es',
  }, {
    db,
    getClassroom: async () => classroom,
    inspectPdf: async () => true,
    promoteUpload: async (temporaryPath, storageKey) => { promoted = { temporaryPath, storageKey }; },
    removeStored: async () => assert.fail('successful upload should not be removed'),
  });

  assert.equal(result.format, 'pdf');
  assert.equal(result.classroom_name, 'Spanish 2');
  assert.equal(result.byte_size, 2048);
  assert.equal(promoted.temporaryPath, '/tmp/upload');
  assert.match(promoted.storageKey, /^[a-f0-9-]+\.pdf$/);
});

test('student cannot promote or insert a class file', async () => {
  let promoted = false;
  await assert.rejects(
    addClassroomBook({
      classroomId: classroom.id,
      teacherId,
      file: { path: '/tmp/upload', originalname: 'book.epub', size: 100 },
      title: 'Book',
      language: 'es',
    }, {
      db: { query: async () => assert.fail('student upload must not query inserts') },
      getClassroom: async () => ({ ...classroom, role: 'student' }),
      promoteUpload: async () => { promoted = true; },
    }),
    (error) => error.status === 403 && error.code === 'class_book_teacher_access_required',
  );
  assert.equal(promoted, false);
});

test('CBZ upload requires its OCR language before archive inspection', async () => {
  let inspected = false;
  await assert.rejects(
    addClassroomBook({
      classroomId: classroom.id,
      teacherId,
      file: { path: '/tmp/upload', originalname: 'comic.cbz', size: 100 },
      title: 'Comic',
      language: '',
    }, {
      db: { query: async () => assert.fail('invalid upload must not insert') },
      getClassroom: async () => classroom,
      inspectZip: async () => { inspected = true; return true; },
    }),
    (error) => error.status === 400 && /English or Spanish/.test(error.message),
  );
  assert.equal(inspected, false);
});

test('Library catalog returns class books but excludes PDFs at the query boundary', async () => {
  let statement = '';
  const books = await listAccessibleClassBooks(teacherId, {
    db: {
      async query(sql) {
        statement = sql;
        return { rows: [{
          id: '33333333-3333-4333-8333-333333333333',
          classroom_id: classroom.id,
          classroom_name: classroom.name,
          title: 'Novel',
          author: null,
          original_filename: 'novel.epub',
          format: 'epub',
          mime_type: 'application/epub+zip',
          byte_size: '4096',
          language: 'es',
          created_at: new Date().toISOString(),
          access_role: 'teacher',
        }] };
      },
    },
  });
  assert.match(statement, /cb\.format IN \('epub', 'cbz'\)/);
  assert.equal(books[0].byte_size, 4096);
});

test('teacher deletion removes the metadata and the one shared stored file', async () => {
  const queries = [];
  let removed = null;
  await deleteClassroomBook('33333333-3333-4333-8333-333333333333', teacherId, {
    db: {
      async query(sql) {
        queries.push(sql);
        if (/SELECT id/.test(sql)) {
          return { rows: [{ id: '33333333-3333-4333-8333-333333333333', classroom_id: classroom.id, storage_key: '33333333-3333-4333-8333-333333333333.epub' }] };
        }
        return { rows: [] };
      },
    },
    getClassroom: async () => classroom,
    removeStored: async (key, options) => { removed = { key, options }; },
  });
  assert.equal(queries.length, 3);
  assert.match(queries[1], /DELETE FROM classroom_books/);
  assert.match(queries[2], /DELETE FROM library_book_progress/);
  assert.deepEqual(removed, {
    key: '33333333-3333-4333-8333-333333333333.epub',
    options: { ignoreMissing: true },
  });
});

test('storage signature checks distinguish ZIP archives and PDFs', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'polycast-class-files-'));
  const zipPath = path.join(directory, 'book.epub');
  const pdfPath = path.join(directory, 'packet.pdf');
  const invalidPath = path.join(directory, 'invalid.pdf');
  try {
    await fs.writeFile(zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
    await fs.writeFile(pdfPath, Buffer.from('%PDF-1.7'));
    await fs.writeFile(invalidPath, Buffer.from('not a document'));
    assert.equal(await isZipArchive(zipPath), true);
    assert.equal(await isPdfDocument(pdfPath), true);
    assert.equal(await isPdfDocument(invalidPath), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
