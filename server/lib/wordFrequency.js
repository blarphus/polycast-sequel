import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const corpus = require('subtlex-word-frequencies');

// ---------------------------------------------------------------------------
// English: SUBTLEX-US corpus (npm package, ~74k words)
// ---------------------------------------------------------------------------

const enRankMap = new Map();
const enCountMap = new Map();
for (let i = 0; i < corpus.length; i++) {
  const key = corpus[i].word.toLowerCase();
  if (!enRankMap.has(key)) enRankMap.set(key, i + 1);
  if (!enCountMap.has(key)) enCountMap.set(key, corpus[i].count);
}

// ---------------------------------------------------------------------------
// Other languages: FrequencyWords (OpenSubtitles-derived, Hermit Dave)
// ---------------------------------------------------------------------------

const langMaps = new Map(); // lang code -> { rankMap, countMap }

const FREQ_LANGS = ['es', 'pt', 'fr', 'de', 'ja'];
for (const lang of FREQ_LANGS) {
  const filePath = new URL(`../data/frequency/${lang}.txt`, import.meta.url);
  const text = readFileSync(filePath, 'utf-8');
  const rankMap = new Map();
  const countMap = new Map();
  let rank = 1;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const lastSpace = line.lastIndexOf(' ');
    const word = line.slice(0, lastSpace).toLowerCase();
    const count = parseInt(line.slice(lastSpace + 1), 10);
    if (word && !rankMap.has(word)) {
      rankMap.set(word, rank++);
      countMap.set(word, count);
    }
  }
  langMaps.set(lang, { rankMap, countMap });
}

// ---------------------------------------------------------------------------
// Shared rank-to-band conversion (1-10 scale)
// ---------------------------------------------------------------------------

function rankToBand(rank) {
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up an English word's raw occurrence count from the SUBTLEX-US corpus.
 * Returns null if the word is not in the corpus.
 */
export function getEnglishFrequencyCount(word) {
  return enCountMap.get(word.toLowerCase()) ?? null;
}

/**
 * Look up an English word's frequency on a 1-10 scale using the SUBTLEX-US corpus.
 * Returns null if the word is not in the corpus.
 */
export function getEnglishFrequency(word) {
  const rank = enRankMap.get(word.toLowerCase());
  if (rank === undefined) return null;
  return rankToBand(rank);
}

/**
 * Apply corpus frequency data to a word for any supported language.
 * English uses SUBTLEX-US; es/pt/fr/de/ja use FrequencyWords data.
 * Returns { frequency, frequency_count } with overrides applied.
 */
export function applyCorpusFrequency(word, targetLang, currentFrequency) {
  // English: use SUBTLEX-US
  if (targetLang === 'en' || targetLang?.startsWith('en-')) {
    let frequency = currentFrequency;
    let frequency_count = null;
    const corpusFreq = getEnglishFrequency(word);
    if (corpusFreq !== null) frequency = corpusFreq;
    frequency_count = getEnglishFrequencyCount(word);
    return { frequency, frequency_count };
  }

  // Other languages: use FrequencyWords data
  const langData = langMaps.get(targetLang);
  if (!langData) return { frequency: currentFrequency, frequency_count: null };

  const lower = word.toLowerCase();
  const rank = langData.rankMap.get(lower);
  const count = langData.countMap.get(lower) ?? null;
  if (rank === undefined) return { frequency: currentFrequency, frequency_count: count };

  return { frequency: rankToBand(rank), frequency_count: count };
}

// Backward-compatible alias
export const applyEnglishFrequency = applyCorpusFrequency;
