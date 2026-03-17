/**
 * enrichWord.js — shared word enrichment logic.
 * Used by both the dictionary route (POST /api/dictionary/enrich)
 * and the stream route (POST /api/stream/posts) at word-list creation time.
 */

import { applyCorpusFrequency } from './lib/wordFrequency.js';
import { normalizeLemma, normalizeForms } from './lib/normalizeWordFields.js';
import { callGemini } from './lib/gemini.js';
import { fetchWordImage } from './lib/imageSearch.js';
import logger from './logger.js';
import pool from './db.js';


function parseFrequency(str) {
  if (!str) return null;
  const n = parseInt(str, 10);
  if (isNaN(n)) {
    logger.error('Gemini enrich returned non-numeric frequency: %s', str);
    return null;
  }
  return n;
}

function accentFoldKey(word) {
  return word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Persist a Gemini-generated fallback definition into the wiktionary table
 * so future lookups can use it directly. Fire-and-forget.
 */
export function persistGeminiFallbackSense({ word, lang, pos, definition }) {
  if (!word || !lang || !pos || !definition) return;

  const key = accentFoldKey(word);
  const newSense = JSON.stringify([{ glosses: [definition], source: 'gemini' }]);
  const glossCheck = JSON.stringify([definition]);

  (async () => {
    // Try UPDATE: append to existing row if gloss not already present
    const { rowCount } = await pool.query(
      `UPDATE wiktionary
       SET senses = senses || $4::jsonb
       WHERE lang = $1 AND key = $2 AND pos = $3
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(senses) AS s
           WHERE s->'glosses' @> $5::jsonb
         )`,
      [lang, key, pos, newSense, glossCheck]
    );
    if (rowCount > 0) { logger.info('[wikt-persist] Appended sense: %s/%s/%s', lang, word, pos); return; }

    // rowCount=0 → either row exists with duplicate gloss, or no row at all
    const { rows } = await pool.query(
      'SELECT id FROM wiktionary WHERE lang = $1 AND key = $2 AND pos = $3 LIMIT 1',
      [lang, key, pos]
    );
    if (rows.length > 0) return; // duplicate, skip

    // No row — INSERT new one
    await pool.query(
      `INSERT INTO wiktionary (lang, key, word, pos, senses, forms, translations)
       VALUES ($1, $2, $3, $4, $5::jsonb, NULL, NULL)`,
      [lang, key, word, pos, newSense]
    );
    logger.info('[wikt-persist] Inserted new row: %s/%s/%s', lang, word, pos);
  })().catch(err => {
    logger.error({ err }, '[wikt-persist] Failed for %s/%s', lang, word);
  });
}

async function queryWiktionary(word, lang) {
  const { rows } = await pool.query(
    'SELECT pos, senses, forms, translations FROM wiktionary WHERE lang = $1 AND key = $2',
    [lang, accentFoldKey(word)],
  );
  return rows;
}

function flattenSenses(rows) {
  const senses = [];
  for (const row of rows) {
    for (const sense of row.senses || []) {
      for (const gloss of sense.glosses || []) {
        if (!gloss) continue;
        senses.push({ gloss, pos: row.pos, tags: [], example: null });
      }
    }
  }
  return senses;
}

/**
 * Detect "form of" glosses (e.g. "gerund of torcer", "third-person singular
 * present indicative of fazer") and extract the lemma. Returns the lemma
 * string or null if the gloss is a real definition.
 */
const FORM_OF_RE = /^(?:[\w/'-]+\s+)*?(?:form|participle|gerund|infinitive|supine|singular|plural|tense|indicative|subjunctive|imperative|conditional|inflection|diminutive|augmentative|superlative|comparative)\s+of\s+(\S+)$/i;

function extractFormOfLemma(senses) {
  if (senses.length === 0) return null;
  // Only chase if ALL senses are "form of" references
  const lemmas = new Set();
  for (const s of senses) {
    const m = FORM_OF_RE.exec(s.gloss);
    if (!m) return null; // at least one real definition exists — no need to chase
    lemmas.add(accentFoldKey(m[1]));
  }
  // All senses point to the same lemma (or close variants)
  if (lemmas.size === 1) return [...lemmas][0];
  // Multiple different lemmas — pick the first one mentioned
  const m = FORM_OF_RE.exec(senses[0].gloss);
  return m ? m[1] : null;
}

export async function fetchWiktSenses(word, targetLang, _nativeLang) {
  const rows = await queryWiktionary(word, targetLang);
  const senses = flattenSenses(rows);

  // If all senses are "form of lemma" references, look up the lemma instead
  const chasedLemma = extractFormOfLemma(senses);
  if (chasedLemma) {
    const lemmaRows = await queryWiktionary(chasedLemma, targetLang);
    const lemmaSenses = flattenSenses(lemmaRows);
    if (lemmaSenses.length > 0) {
      // Find the properly-cased word from the lemma DB row
      const lemmaWord = lemmaRows[0]?.word || chasedLemma;
      logger.info('[wikt-lemma] %s → %s (%s), found %d lemma senses', word, lemmaWord, senses[0].gloss, lemmaSenses.length);
      return { senses: lemmaSenses, resolvedLemma: lemmaWord };
    }
  }

  return { senses, resolvedLemma: null };
}

export async function fetchWiktTranslations(word, nativeLang) {
  const rows = await queryWiktionary(word, 'en');
  const sensesMap = new Map();
  for (const row of rows) {
    const pos = row.pos || '';
    for (const sense of row.senses || []) {
      const senseText = (sense.glosses || []).join('; ');
      if (!senseText || sensesMap.has(senseText)) continue;
      sensesMap.set(senseText, { sense: senseText, pos, words: [] });
    }
    for (const t of row.translations || []) {
      if (t.code !== nativeLang || !t.word) continue;
      const key = (t.sense || '').toLowerCase();
      let matched = false;
      for (const [senseText, entry] of sensesMap) {
        const senseLower = senseText.toLowerCase();
        if (!key || senseLower.includes(key) || key.includes(senseLower)) {
          entry.words.push(t.word);
          matched = true;
          break;
        }
      }
      // If no sense matched, attach to the first sense of the same POS
      if (!matched) {
        for (const [, entry] of sensesMap) {
          if (entry.pos === pos) {
            entry.words.push(t.word);
            break;
          }
        }
      }
    }
  }
  return Array.from(sensesMap.values());
}

// Shared field descriptions used by all enrichment prompts
const FIELD_TRANSLATION = (nativeLang) =>
  `- TRANSLATION: The word translated into ${nativeLang}. Just the word(s), nothing else.`;
const FIELD_FREQUENCY = `- FREQUENCY: An integer 1-10 rating how common this word is for a language learner:
  1-2: Rare/specialized words most learners won't encounter
  3-4: Uncommon words that appear in specific contexts
  5-6: Moderately common words useful for intermediate learners
  7-8: Common everyday words important for conversation
  9-10: Essential high-frequency words (top 500 most used)`;
const FIELD_EXAMPLE = (targetLang) =>
  `- EXAMPLE: A short example sentence in ${targetLang || 'the target language'} using the word. Wrap the word with tildes like ~word~. Keep it under 15 words.`;
const FIELD_SENTENCE_TRANSLATION = (nativeLang) =>
  `- SENTENCE_TRANSLATION: A natural translation of the EXAMPLE sentence into ${nativeLang}. Wrap the translated equivalent of the target word with tildes like ~word~. Keep the same meaning and tone.`;
const FIELD_IMAGE_TERM = `- IMAGE_TERM: An English search term (1-4 words) for finding a stock photo of this word. Always return an English term, even if the target language is not English. For clear concrete nouns, just return the English translation (e.g. "gato" → "cat", "ponte" → "bridge"). For words with multiple meanings, disambiguate (e.g. "bat" in sports → "baseball bat"). For abstract words, suggest a visual representation (e.g. "freedom" → "open bird cage"). For verbs/adjectives, suggest a depictable scene (e.g. "fragile" → "cracked glass"). Never return an empty string.`;
const FIELD_LEMMA = `- LEMMA: The dictionary/base form of this word in the target language.
  For verbs: the infinitive (e.g. "to work" in English, "trabajar" in Spanish).
  For nouns: the singular (e.g. "cat" not "cats").
  For adjectives/adverbs: the positive form (e.g. "big" not "bigger").
  If the word is already its base form, return it unchanged. Leave empty for
  particles, prepositions, conjunctions, and other uninflected words.`;

/**
 * Build a Gemini enrichment prompt from shared + path-specific parts.
 *
 * @param {object} opts
 * @param {string} opts.word
 * @param {string} opts.sentence
 * @param {string} opts.nativeLang
 * @param {string|null} opts.targetLang
 * @param {string} opts.fieldNames - e.g. "TRANSLATION // FREQUENCY // ..."
 * @param {string} opts.extraFieldDescs - path-specific field description lines
 * @param {string} opts.contextLine - extra context after the header (e.g. definition for Path C)
 * @param {string} opts.senseListBlock - sense list block for Path A (empty for others)
 */
function buildEnrichPrompt({ word, sentence, nativeLang, targetLang, fieldNames, extraFieldDescs, contextLine, senseListBlock }) {
  return `You are a language-learning assistant. A user clicked the word "${word}" in: "${sentence}".
${targetLang ? `The sentence is in ${targetLang}.` : ''}
The user's native language is ${nativeLang}.
${contextLine}${senseListBlock}
Respond in EXACTLY this format (${fieldNames.split('//').length} parts separated by " // "):
${fieldNames}

${FIELD_TRANSLATION(nativeLang)}
${extraFieldDescs}${FIELD_FREQUENCY}
${FIELD_EXAMPLE(targetLang)}
${FIELD_SENTENCE_TRANSLATION(nativeLang)}
${FIELD_IMAGE_TERM}
${FIELD_LEMMA}`;
}

/**
 * Full word enrichment: translation, definition, POS, frequency, example,
 * image_url, lemma, forms.
 *
 * @param {string} word - The word to enrich
 * @param {string} sentence - Sentence context (can be empty string for word-list creation)
 * @param {string} nativeLang - User's native language code
 * @param {string|null} targetLang - Target language code
 * @param {number|null} senseIndex - Pre-identified Wiktionary sense index (optional)
 * @returns {Promise<{word, translation, definition, part_of_speech, frequency, frequency_count, example_sentence, image_url, lemma, forms}>}
 */
export async function enrichWord(word, sentence, nativeLang, targetLang, senseIndex = null) {
  const _t0 = Date.now();

  // Query Wiktionary DB directly — gives access to both senses AND forms
  let wiktRows = targetLang
    ? await queryWiktionary(word, targetLang)
    : [];
  let wiktSenses = flattenSenses(wiktRows);

  // If all senses are "form of lemma" references, chase the lemma
  let wiktResolvedLemma = null;
  const formOfLemma = extractFormOfLemma(wiktSenses);
  if (formOfLemma) {
    const lemmaRows = await queryWiktionary(formOfLemma, targetLang);
    const lemmaSenses = flattenSenses(lemmaRows);
    if (lemmaSenses.length > 0) {
      wiktResolvedLemma = lemmaRows[0]?.word || formOfLemma;
      logger.info('[enrich-lemma] %s → %s (%s), found %d lemma senses', word, wiktResolvedLemma, wiktSenses[0].gloss, lemmaSenses.length);
      wiktRows = lemmaRows;
      wiktSenses = lemmaSenses;
    }
  }
  const _t1 = Date.now();
  logger.info('[enrich-timing] %s — Wiktionary DB: %dms (found %d senses)', word, _t1 - _t0, wiktSenses.length);

  let translation, definition, part_of_speech, frequency, example_sentence, sentence_translation, geminiImageTerm, lemma;

  // Path C: senseIndex pre-identified by /lookup — use directly, skip sense-picking
  const hasSenseIndex = typeof senseIndex === 'number' && senseIndex >= 0;
  if (hasSenseIndex && wiktSenses.length > 0 && senseIndex < wiktSenses.length) {
    definition = wiktSenses[senseIndex].gloss;
    part_of_speech = wiktSenses[senseIndex].pos || null;

    const prompt = buildEnrichPrompt({
      word, sentence, nativeLang, targetLang,
      fieldNames: 'TRANSLATION // FREQUENCY // EXAMPLE // SENTENCE_TRANSLATION // IMAGE_TERM // LEMMA',
      extraFieldDescs: '',
      contextLine: `The word means: "${definition}" (${part_of_speech || 'unknown POS'}).`,
      senseListBlock: '',
    });

    const raw = await callGemini(prompt);
    const _t2 = Date.now();
    logger.info('[enrich-timing] %s — Gemini (Path C): %dms', word, _t2 - _t1);
    const parts = raw.split('//').map((s) => s.trim());
    if (parts.length < 6) {
      throw new Error(`Gemini enrich returned ${parts.length} parts instead of 6 for Path C`);
    }

    translation = parts[0] || '';
    frequency = parseFrequency(parts[1]);
    example_sentence = parts[2] || null;
    sentence_translation = parts[3] || null;
    geminiImageTerm = parts[4]?.trim() || null;
    lemma = parts[5]?.trim() || null;
  } else if (hasSenseIndex && (wiktSenses.length === 0 || senseIndex >= wiktSenses.length)) {
    throw new Error(`Sense index ${senseIndex} is invalid for ${wiktSenses.length} available senses`);
  }

  // Path A/B: only run if Path C didn't set translation (i.e. it was skipped)
  if (translation === undefined) {
    if (wiktSenses.length > 0) {
      // Path A: Wiktionary senses available — ask Gemini to pick the best one
      const senseList = wiktSenses.map((s, i) => `${i}: [${s.pos}] ${s.gloss}`).join('\n');

      const prompt = buildEnrichPrompt({
        word, sentence, nativeLang, targetLang,
        fieldNames: 'TRANSLATION // SENSE_INDEX // FREQUENCY // EXAMPLE // SENTENCE_TRANSLATION // IMAGE_TERM // FALLBACK_DEFINITION // LEMMA',
        extraFieldDescs: `- SENSE_INDEX: The integer index (0-${wiktSenses.length - 1}) of the sense that best matches how "${word}" is used in the sentence. If NONE of the senses match, return -1.\n- FALLBACK_DEFINITION: A brief explanation of how this word is used in the given sentence, in ${nativeLang}. 15 words max. No markdown. Used when SENSE_INDEX is -1.\n`,
        contextLine: '',
        senseListBlock: `\nHere are the dictionary senses for "${word}":\n${senseList}\n`,
      });

      const raw = await callGemini(prompt);
      const _t2 = Date.now();
      logger.info('[enrich-timing] %s — Gemini (Path A): %dms', word, _t2 - _t1);

      const parts = raw.split('//').map((s) => s.trim());
      if (parts.length < 8) {
        throw new Error(`Gemini enrich returned ${parts.length} parts instead of 8 for the Wiktionary path`);
      }

      translation = parts[0] || '';

      // Resolve definition + POS from sense index
      const resolvedSenseIndex = parseInt(parts[1], 10);
      if (!isNaN(resolvedSenseIndex) && resolvedSenseIndex >= 0 && resolvedSenseIndex < wiktSenses.length) {
        definition = wiktSenses[resolvedSenseIndex].gloss;
        part_of_speech = wiktSenses[resolvedSenseIndex].pos || null;
      } else {
        // No matching sense — use Gemini's fallback definition
        definition = parts[6]?.trim() || '';
        logger.info('[enrich] %s — no Wiktionary sense matched (index=%s), using Gemini fallback: "%s"', word, parts[1], definition);
        if (definition && targetLang) {
          persistGeminiFallbackSense({ word, lang: targetLang, pos: wiktSenses[0]?.pos || 'unknown', definition });
        }
      }

      frequency = parseFrequency(parts[2]);
      example_sentence = parts[3] || null;
      sentence_translation = parts[4] || null;
      geminiImageTerm = parts[5]?.trim() || null;
      lemma = parts[7]?.trim() || null;
    } else {
      // Path B: No Wiktionary senses — full Gemini generation
      const prompt = buildEnrichPrompt({
        word, sentence, nativeLang, targetLang,
        fieldNames: 'TRANSLATION // DEFINITION // PART_OF_SPEECH // FREQUENCY // EXAMPLE // SENTENCE_TRANSLATION // IMAGE_TERM // LEMMA',
        extraFieldDescs: `- DEFINITION: A brief explanation of how this word is used in the given sentence, in ${nativeLang}. 15 words max. No markdown.\n- PART_OF_SPEECH: One of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle. Lowercase English.\n`,
        contextLine: '',
        senseListBlock: '',
      });

      const raw = await callGemini(prompt);
      const _t2 = Date.now();
      logger.info('[enrich-timing] %s — Gemini (Path B): %dms', word, _t2 - _t1);

      const parts = raw.split('//').map((s) => s.trim());
      if (parts.length < 8) {
        throw new Error(`Gemini enrich returned ${parts.length} parts instead of 8 for the direct generation path`);
      }
      translation = parts[0] || '';
      definition = parts[1] || '';
      part_of_speech = parts[2] || null;
      frequency = parseFrequency(parts[3]);
      example_sentence = parts[4] || null;
      sentence_translation = parts[5] || null;
      geminiImageTerm = parts[6]?.trim() || null;
      lemma = parts[7]?.trim() || null;

      if (definition && part_of_speech && targetLang) {
        persistGeminiFallbackSense({ word, lang: targetLang, pos: part_of_speech, definition });
      }
    }
  } // end if (translation === undefined) — Path A/B

  // For English target words, override Gemini frequency with SUBTLEX-US corpus data
  const corpusFreq = applyCorpusFrequency(word, targetLang, frequency);
  frequency = corpusFreq.frequency;
  const frequency_count = corpusFreq.frequency_count;

  // Use Kaikki forms if available; find the DB row matching the resolved POS
  let kaikkiForms = null;
  if (part_of_speech && wiktRows.length > 0) {
    const matchingRow = wiktRows.find(r => r.pos === part_of_speech);
    if (matchingRow?.forms && matchingRow.forms.length > 1) {
      kaikkiForms = matchingRow.forms;
    }
  }
  // Fall back to all forms from any row if no POS match
  if (!kaikkiForms && wiktRows.length > 0) {
    for (const row of wiktRows) {
      if (row.forms && row.forms.length > 1) {
        kaikkiForms = row.forms;
        break;
      }
    }
  }

  // Filter out Kaikki metadata tags (e.g. "no-table-tags", "fr-conj-auto") and template placeholders
  const forms = kaikkiForms
    ? normalizeForms(kaikkiForms.filter(f => !/^[a-z]{2}-/.test(f) && !f.includes('table-tags') && !f.includes(' + ')).join(', '))
    : null;
  lemma = normalizeLemma(lemma, part_of_speech, targetLang) || wiktResolvedLemma;

  // Fetch image: use Gemini's IMAGE_TERM, then native translation (English gets better results), then target word
  const imageSearchTerm = geminiImageTerm || translation || word;
  const _tImg0 = Date.now();
  const image_url = await fetchWordImage(imageSearchTerm);
  const _tImg1 = Date.now();
  logger.info('[enrich-timing] %s — Image search ("%s"): %dms', word, imageSearchTerm, _tImg1 - _tImg0);
  logger.info('[enrich-timing] %s — TOTAL: %dms', word, _tImg1 - _t0);

  return { word, translation, definition, part_of_speech, frequency, frequency_count, example_sentence, sentence_translation, image_url, lemma, forms, image_term: geminiImageTerm || translation || word };
}
