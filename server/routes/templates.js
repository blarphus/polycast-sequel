import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { authMiddleware, requireTeacher } from '../auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Module-level cache keyed by textbook id */
const cache = new Map();

function loadTextbook(id) {
  if (cache.has(id)) return cache.get(id);

  const filePath = path.join(__dirname, '..', 'data', 'templates', `${id}.json`);
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  cache.set(id, data);
  return data;
}

// Pre-load all available textbooks
const TEXTBOOK_IDS = ['aef1'];
for (const id of TEXTBOOK_IDS) {
  loadTextbook(id);
}

const router = Router();

// GET /api/templates — list all textbooks with unit summaries (no word arrays)
router.get('/api/templates', authMiddleware, requireTeacher, (_req, res) => {
  const templates = TEXTBOOK_IDS.map((id) => {
    const book = cache.get(id);
    return {
      id: book.id,
      title: book.title,
      publisher: book.publisher,
      language: book.language,
      level: book.level,
      units: book.units
        .filter((u) => u.words.length > 0)
        .map((u) => ({
          id: u.id,
          title: u.title,
          description: u.description,
          wordCount: u.words.length,
        })),
    };
  });

  res.json({ templates });
});

// GET /api/templates/:textbookId/:unitId — full unit detail with words
router.get('/api/templates/:textbookId/:unitId', authMiddleware, requireTeacher, (req, res) => {
  const { textbookId, unitId } = req.params;

  const book = cache.get(textbookId);
  if (!book) {
    return res.status(404).json({ error: 'Textbook not found' });
  }

  const unit = book.units.find((u) => u.id === unitId);
  if (!unit) {
    return res.status(404).json({ error: 'Unit not found' });
  }

  res.json({
    textbook: { id: book.id, title: book.title, language: book.language },
    unit: { id: unit.id, title: unit.title, description: unit.description, words: unit.words },
  });
});

export default router;
