import { readFileSync } from 'node:fs';
import { canonicalLemmaKey } from './normalizeWordFields.js';

const EMBEDDED_LANGUAGES = new Set(['en', 'es']);
const catalogs = new Map();

function loadCatalog(language) {
  if (!EMBEDDED_LANGUAGES.has(language)) return null;
  const existing = catalogs.get(language);
  if (existing) return existing;

  const rows = new Map();
  const source = readFileSync(new URL(`../data/frequency/${language}.txt`, import.meta.url), 'utf8');
  let rank = 0;
  for (const line of source.split('\n')) {
    const split = line.lastIndexOf(' ');
    if (split <= 0) continue;
    const lemma = line.slice(0, split).trim().normalize('NFC');
    const zipf = Number(line.slice(split + 1));
    if (!lemma || !Number.isFinite(zipf)) continue;
    rank += 1;
    const key = canonicalLemmaKey(lemma);
    if (!rows.has(key)) rows.set(key, { lemma, rank, zipf });
  }
  const catalog = { rows, total: rank };
  catalogs.set(language, catalog);
  return catalog;
}

export function lookupEmbeddedFrequency(language, lemma, bandForRank) {
  const lang = String(language || '').trim().toLowerCase().split('-')[0];
  const catalog = loadCatalog(lang);
  if (!catalog) return null;
  const key = canonicalLemmaKey(lemma);
  const row = catalog.rows.get(key);
  if (!row) return null;
  const occurrences = Math.max(1, Math.round(10 ** row.zipf));
  return {
    rank_version_id: null,
    rank_version: `embedded-wordfreq-${lang}`,
    catalog_lemma_key: key,
    canonical_lemma: row.lemma,
    lemma_rank: row.rank,
    lemma_occurrences_per_billion: occurrences,
    zipf: row.zipf,
    frequency_band: bandForRank(row.rank),
    frequency_confidence: 'low',
    frequency_percentile: catalog.total <= 1 ? 1 : 1 - ((row.rank - 1) / (catalog.total - 1)),
    frequency_sources: [{ id: 'wordfreq-snapshot', rank: row.rank, value: occurrences }],
    catalog_wiktionary_id: null,
    catalog_sense_index: null,
    catalog_gloss_index: null,
    catalog_provisional_sense_id: null,
    sense_order: null,
    sense_rank: null,
  };
}

export function embeddedFrequencyCacheStats() {
  return {
    loadedLanguages: [...catalogs.keys()].sort(),
    entries: [...catalogs.values()].reduce((sum, catalog) => sum + catalog.total, 0),
  };
}
