import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Module-level cache keyed by language code */
const cache = new Map();

/**
 * Load the CEFR word map for a language from server/data/cefr/{language}.json.
 * Returns null if no file exists (unsupported language).
 */
function loadCefrMap(language) {
  if (cache.has(language)) return cache.get(language);

  const filePath = path.join(__dirname, '..', 'data', 'cefr', `${language}.json`);
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    cache.set(language, data);
    return data;
  } catch {
    cache.set(language, null);
    return null;
  }
}

/**
 * Tokenize transcript segments into lowercase word tokens.
 */
function tokenize(segments) {
  const text = segments.map((s) => s.text).join(' ').toLowerCase();
  return text.match(/[\p{L}]+/gu) || [];
}

/**
 * Estimate the CEFR difficulty level of a transcript.
 * Uses the 95% vocabulary coverage threshold.
 *
 * Returns a CEFR level string ('A1'–'C2') or null if:
 * - No CEFR map exists for the language
 * - Insufficient word coverage (< 20% found in map)
 */
export function estimateCefrLevel(segments, language) {
  const lang = language?.replace(/-.*$/, '');
  const cefrMap = loadCefrMap(lang);
  if (!cefrMap) return null;

  const tokens = tokenize(segments);
  if (tokens.length === 0) return null;

  const total = tokens.length;
  const counts = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0, unknown: 0 };

  for (const token of tokens) {
    const level = cefrMap[token];
    if (level && counts[level] !== undefined) {
      counts[level]++;
    } else {
      counts.unknown++;
    }
  }

  const found = total - counts.unknown;
  if (found < total * 0.2) return null;

  let cumulative = 0;
  for (const level of LEVELS) {
    cumulative += counts[level];
    if (cumulative / total >= 0.95) return level;
  }

  return 'C2';
}
