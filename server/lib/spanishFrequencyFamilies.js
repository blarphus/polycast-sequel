import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFormsValue } from './normalizeWordFields.js';

const WORD_TOKEN = /^[\p{L}\p{M}']+$/u;
const EXPLICIT_CLITIC = /(?:me|te|se|nos|os)(?:(?:lo|la|los|las|le|les))?$/u;
const MAX_FAMILY_FORMS = 128;
const AMBIGUOUS_FORM_RATIO = 3;
const SOURCE_CONFIG = Object.freeze([
  { id: 'wordfreq-snapshot', weight: 1 },
  { id: 'tubelex-es-lemma-2025', weight: 1.5 },
]);

let cachedCorpus = null;

function canonicalToken(value) {
  return String(value || '').trim().normalize('NFC').toLocaleLowerCase('es');
}

function accentless(value) {
  return canonicalToken(value).normalize('NFD').replace(/\p{M}/gu, '');
}

function bandForRank(rank) {
  if (rank <= 500) return 10;
  if (rank <= 1000) return 9;
  if (rank <= 2000) return 8;
  if (rank <= 4000) return 7;
  if (rank <= 7000) return 6;
  if (rank <= 12000) return 5;
  if (rank <= 20000) return 4;
  if (rank <= 35000) return 3;
  if (rank <= 60000) return 2;
  return 1;
}

function rankForDescendingValue(sortedValues, value) {
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedValues[middle] >= value) low = middle + 1;
    else high = middle;
  }
  return Math.max(1, low);
}

function rankForDescendingScore(sortedScores, score) {
  let low = 0;
  let high = sortedScores.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedScores[middle] > score) low = middle + 1;
    else high = middle;
  }
  return low + 1;
}

function sourceFromEntries(id, weight, entries) {
  const values = new Map();
  const firstRanks = new Map();
  entries.forEach(({ token, value }, index) => {
    const key = canonicalToken(token);
    if (!key || !Number.isFinite(value) || value <= 0) return;
    values.set(key, (values.get(key) || 0) + value);
    if (!firstRanks.has(key)) firstRanks.set(key, index + 1);
  });
  return {
    id,
    weight,
    values,
    firstRanks,
    descendingValues: [...values.values()].sort((a, b) => b - a),
  };
}

function parseWordfreq() {
  const text = fs.readFileSync(new URL('../data/frequency/es.txt', import.meta.url), 'utf8');
  const entries = [];
  for (const line of text.split('\n')) {
    const split = line.lastIndexOf(' ');
    if (split <= 0) continue;
    const zipf = Number(line.slice(split + 1));
    if (!Number.isFinite(zipf)) continue;
    entries.push({ token: line.slice(0, split), value: 10 ** zipf });
  }
  return sourceFromEntries(SOURCE_CONFIG[0].id, SOURCE_CONFIG[0].weight, entries);
}

function parseTubelex() {
  const file = new URL('../data/frequency-sources/tubelex-es-lemma-pos.tsv.xz', import.meta.url);
  const text = execFileSync('xz', ['-dc', fileURLToPath(file)], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  const entries = [];
  for (const line of text.split('\n').slice(1)) {
    if (!line) continue;
    const [token, rawValue] = line.split('\t');
    const value = Number(rawValue);
    if (token && Number.isFinite(value) && value > 0) entries.push({ token, value });
  }
  return sourceFromEntries(SOURCE_CONFIG[1].id, SOURCE_CONFIG[1].weight, entries);
}

function loadCorpus() {
  if (cachedCorpus) return cachedCorpus;
  const sources = [parseWordfreq(), parseTubelex()];
  const exactScores = new Map();
  for (const source of sources) {
    for (const [token, rank] of source.firstRanks) {
      exactScores.set(token, (exactScores.get(token) || 0) + source.weight / (60 + rank));
    }
    delete source.firstRanks;
  }
  cachedCorpus = {
    sources,
    descendingExactScores: [...exactScores.values()].sort((a, b) => b - a),
  };
  return cachedCorpus;
}

function explicitPronominalForm(token, lemma) {
  const normalized = accentless(token);
  const normalizedLemma = accentless(lemma);
  if (normalized === normalizedLemma) return true;
  if (!EXPLICIT_CLITIC.test(normalized)) return false;
  if (/(?:am|em|im)os$/u.test(normalized)) return false;
  const base = normalizedLemma.endsWith('se') ? normalizedLemma.slice(0, -2) : normalizedLemma;
  const stem = base.replace(/(?:ar|er|ir)$/u, '');
  return stem.length >= 1 && normalized.startsWith(stem);
}

export function spanishFamilyTokens({
  lemma,
  forms = null,
  surfaceForm = null,
  partOfSpeech = null,
}) {
  const canonicalLemma = canonicalToken(lemma);
  if (!canonicalLemma || !WORD_TOKEN.test(canonicalLemma)) return [];
  const candidates = [
    canonicalLemma,
    canonicalToken(surfaceForm),
    ...parseFormsValue(forms).map(canonicalToken),
  ];
  const pronominal = String(partOfSpeech || '').toLocaleLowerCase() === 'verb'
    && /(?:ar|er|ir)se$/u.test(accentless(canonicalLemma));
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate) || !WORD_TOKEN.test(candidate)) continue;
    if (pronominal && !explicitPronominalForm(candidate, canonicalLemma)) continue;
    seen.add(candidate);
    unique.push(candidate);
    if (unique.length >= MAX_FAMILY_FORMS) break;
  }
  return unique;
}

export function rankSpanishFrequencyFamily({
  lemma,
  forms = null,
  surfaceForm = null,
  partOfSpeech = null,
}) {
  const tokens = spanishFamilyTokens({ lemma, forms, surfaceForm, partOfSpeech });
  if (!tokens.length) return null;
  const corpus = loadCorpus();
  const canonicalLemma = canonicalToken(lemma);
  const pronominal = String(partOfSpeech || '').toLocaleLowerCase() === 'verb'
    && /(?:ar|er|ir)se$/u.test(accentless(canonicalLemma));
  const sourceEvidence = [];
  let fusedScore = 0;
  let evidenceFormCount = 0;

  for (const source of corpus.sources) {
    const matched = [];
    const excluded = [];
    let familyValue = 0;
    const lemmaValue = source.values.get(canonicalLemma) || 0;
    for (const token of tokens) {
      const value = source.values.get(token);
      if (!value) continue;
      if (!pronominal && token !== canonicalLemma && lemmaValue > 0
        && value > lemmaValue * AMBIGUOUS_FORM_RATIO) {
        excluded.push(token);
        continue;
      }
      familyValue += value;
      matched.push(token);
    }
    if (familyValue <= 0) continue;
    const familyRank = rankForDescendingValue(source.descendingValues, familyValue);
    fusedScore += source.weight / (60 + familyRank);
    evidenceFormCount = Math.max(evidenceFormCount, matched.length);
    sourceEvidence.push({
      id: source.id,
      rank: familyRank,
      weight: source.weight,
      value: Math.round(familyValue),
      aggregation: 'bounded-inflection-family',
      matched_forms: matched.length,
      excluded_ambiguous_forms: excluded.length,
    });
  }
  if (!sourceEvidence.length) return null;

  const rank = rankForDescendingScore(corpus.descendingExactScores, fusedScore);
  const wordfreq = sourceEvidence.find((source) => source.id === 'wordfreq-snapshot');
  return {
    lemma_rank: rank,
    frequency_band: bandForRank(rank),
    occurrences_per_billion: wordfreq?.value ?? null,
    confidence: sourceEvidence.length >= 2 && evidenceFormCount >= 2 ? 'medium' : 'low',
    sources: sourceEvidence,
    family_tokens: tokens,
  };
}

export function applySpanishFamilyRanking(entry, input) {
  if (!entry) return entry;
  const ranking = rankSpanishFrequencyFamily(input);
  if (!ranking) return entry;
  return {
    ...entry,
    lemma_rank: ranking.lemma_rank,
    frequency_band: ranking.frequency_band,
    lemma_occurrences_per_billion: ranking.occurrences_per_billion,
    zipf: ranking.occurrences_per_billion > 0
      ? Math.log10(ranking.occurrences_per_billion)
      : null,
    frequency_confidence: ranking.confidence,
    frequency_sources: ranking.sources,
  };
}

export function resetSpanishFamilyCorpusForTests() {
  cachedCorpus = null;
}
