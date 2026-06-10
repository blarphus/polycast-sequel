import { readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Word frequency from wordfreq's blended Zipf data.
//
// data/frequency/<lang>.txt holds "word zipf" per line, where Zipf = log10(occurrences
// per billion words) — wordfreq blends subtitles, Wikipedia, news, web, etc. per language.
// Regenerate with scripts/exportWordfreq.py. Frequency is computed at the LEMMA level: a
// word's frequency is the sum of the per-billion frequencies of all its inflected forms, so
// e.g. "encajar" reflects encaja + encajó + encajamos + … and is identical no matter which
// conjugation the learner clicked.
// ---------------------------------------------------------------------------

const FREQ_LANGS = ['en', 'es', 'pt', 'fr', 'de', 'ja'];

const langMaps = new Map(); // lang -> Map(word -> zipf)
for (const lang of FREQ_LANGS) {
  const filePath = new URL(`../data/frequency/${lang}.txt`, import.meta.url);
  const map = new Map();
  const text = readFileSync(filePath, 'utf-8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    const sp = line.lastIndexOf(' ');
    if (sp < 0) continue;
    const word = line.slice(0, sp);
    const zipf = Number.parseFloat(line.slice(sp + 1));
    if (word && !Number.isNaN(zipf)) map.set(word, zipf);
  }
  langMaps.set(lang, map);
}

function langKey(targetLang) {
  if (!targetLang) return null;
  const base = targetLang.toLowerCase().split('-')[0];
  return langMaps.has(base) ? base : null;
}

// Continuous Zipf (log10 occurrences per billion) -> 1-10 learner band. Thresholds approximate
// the previous rank-based bands (top ~500 words -> 10, the long tail -> 1) at typical Zipf
// magnitudes. The precise value lives in frequency_count (= occurrences per billion).
function zipfToBand(zipf) {
  if (zipf >= 5.0) return 10;
  if (zipf >= 4.5) return 9;
  if (zipf >= 4.2) return 8;
  if (zipf >= 3.9) return 7;
  if (zipf >= 3.7) return 6;
  if (zipf >= 3.4) return 5;
  if (zipf >= 3.1) return 4;
  if (zipf >= 2.7) return 3;
  if (zipf >= 2.3) return 2;
  return 1;
}

function parseForms(forms) {
  if (!forms) return [];
  if (Array.isArray(forms)) return forms;
  if (typeof forms === 'string') {
    const trimmed = forms.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* fall through to comma split */ }
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Look up a single word's Zipf value in a language's table. Returns null if absent.
 */
export function getZipf(word, targetLang) {
  const lang = langKey(targetLang);
  if (!lang || !word) return null;
  const z = langMaps.get(lang).get(String(word).toLowerCase());
  return z ?? null;
}

/**
 * Lemma-level corpus frequency. Sums the per-billion frequencies of the surface word, the
 * lemma, and every inflected form, then converts back to a single Zipf value — so a verb's
 * frequency reflects its whole paradigm and is stable regardless of which form was clicked.
 *
 * @param {string} word           the surface word that was looked up
 * @param {string} targetLang     language of the word (e.g. "es", "pt", "en")
 * @param {number|null} currentFrequency  Gemini's 1-10 estimate, kept if the word isn't in the corpus
 * @param {{ lemma?: string|null, forms?: string|string[]|null }} [opts]
 * @returns {{ frequency: number|null, frequency_count: number|null, zipf: number|null }}
 *   frequency = 1-10 band, frequency_count = occurrences per billion words, zipf = log10(count)
 */
export function applyCorpusFrequency(word, targetLang, currentFrequency, { lemma = null, forms = null } = {}) {
  const lang = langKey(targetLang);
  if (!lang) return { frequency: currentFrequency ?? null, frequency_count: null, zipf: null };
  const map = langMaps.get(lang);

  // Every surface token that counts toward this lemma's frequency.
  const tokens = new Set();
  const add = (s) => {
    if (!s || typeof s !== 'string') return;
    const lower = s.toLowerCase().trim();
    if (lower) tokens.add(lower);
    // English verb lemmas are stored as "to fit"; the corpus has "fit".
    if (lower.startsWith('to ')) tokens.add(lower.slice(3));
  };
  add(word);
  add(lemma);
  for (const f of parseForms(forms)) add(f);

  // Sum per-billion frequencies (per_billion = 10^zipf) across all forms present in the corpus.
  let perBillion = 0;
  for (const t of tokens) {
    const z = map.get(t);
    if (z !== undefined) perBillion += Math.pow(10, z);
  }

  if (perBillion <= 0) {
    // Not in the corpus — keep Gemini's estimate rather than fabricate a number.
    return { frequency: currentFrequency ?? null, frequency_count: null, zipf: null };
  }

  const zipf = Math.log10(perBillion);
  return {
    frequency: zipfToBand(zipf),
    frequency_count: Math.round(perBillion),
    zipf: Math.round(zipf * 100) / 100,
  };
}
