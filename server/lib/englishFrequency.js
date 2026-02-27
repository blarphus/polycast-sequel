import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const corpus = require('subtlex-word-frequencies');

// Build rank map: lowercased word → 1-based rank (1 = most common)
const rankMap = new Map();
// Build count map: lowercased word → raw corpus occurrence count
const countMap = new Map();
for (let i = 0; i < corpus.length; i++) {
  const key = corpus[i].word.toLowerCase();
  if (!rankMap.has(key)) rankMap.set(key, i + 1);
  if (!countMap.has(key)) countMap.set(key, corpus[i].count);
}

/**
 * Look up an English word's raw occurrence count from the SUBTLEX-US corpus.
 * Returns null if the word is not in the corpus.
 */
export function getEnglishFrequencyCount(word) {
  return countMap.get(word.toLowerCase()) ?? null;
}

/**
 * Look up an English word's frequency on a 1-10 scale using the SUBTLEX-US corpus.
 * Returns null if the word is not in the corpus.
 */
export function getEnglishFrequency(word) {
  const rank = rankMap.get(word.toLowerCase());
  if (rank === undefined) return null;

  if (rank <= 500) return 10;
  if (rank <= 1500) return 9;
  if (rank <= 3000) return 8;
  if (rank <= 5000) return 7;
  if (rank <= 8000) return 6;
  if (rank <= 12000) return 5;
  if (rank <= 20000) return 4;
  if (rank <= 35000) return 3;
  if (rank <= 55000) return 2;
  return 1;
}
