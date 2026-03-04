import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import { loadCefrMap } from '../lib/cefrDifficulty.js';
import { validate } from '../lib/validate.js';

const router = Router();

const VALID_LEVELS = ['A1', 'A2', 'B1', 'B2'];

const placementQuery = z.object({
  level: z.enum(['A1', 'A2', 'B1', 'B2'], { message: `level must be one of ${VALID_LEVELS.join(', ')}` }),
  language: z.string().min(1, 'language query parameter is required'),
});

/** Cache: language → { level → words[] } */
const levelWordsCache = new Map();

function getLevelWords(language, level) {
  const cacheKey = language;
  if (levelWordsCache.has(cacheKey)) {
    return levelWordsCache.get(cacheKey)[level] || [];
  }

  const cefrMap = loadCefrMap(language);
  if (!cefrMap) return null;

  const index = {};
  for (const lv of VALID_LEVELS) index[lv] = [];

  for (const [word, lv] of Object.entries(cefrMap)) {
    if (index[lv]) index[lv].push(word);
  }

  levelWordsCache.set(cacheKey, index);
  return index[level] || [];
}

/** Fisher-Yates shuffle (in-place on a copy). */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * GET /api/placement-test?level=A1&language=en
 * Returns 20 random words at the given CEFR level.
 */
router.get('/api/placement-test', authMiddleware, validate({ query: placementQuery }), (req, res) => {
  const { level, language } = req.query;

  const words = getLevelWords(language, level);
  if (words === null) {
    return res.status(400).json({ error: `No CEFR data available for language: ${language}` });
  }

  const selected = shuffle(words).slice(0, 20);

  return res.json({ words: selected, level });
});

export default router;
