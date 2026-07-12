/**
 * enrichWord.js — shared word enrichment logic.
 * Used by both the dictionary route (POST /api/dictionary/enrich)
 * and the stream route (POST /api/stream/posts) at word-list creation time.
 */

import { applyCorpusFrequency } from './lib/wordFrequency.js';
import { normalizeLemma, normalizeForms } from './lib/normalizeWordFields.js';
import { callGemini, callGeminiVision, parseGeminiJson } from './lib/gemini.js';
import { searchAllImages } from './lib/imageSearch.js';
import { pickBestImage } from './lib/imagePick.js';
import { generateWordImage } from './lib/imageGenerate.js';
import { storeImageBytes } from './lib/imageCache.js';
import { findSharedEntry, sharedEntryToEnrichment, storeSharedEntry } from './lib/sharedDictionaryEntries.js';
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

/** Strip trailing punctuation that leaks from gloss patterns (e.g. "atrapalhar:") */
function cleanLemmaRef(raw) {
  return raw.replace(/[^a-zA-ZÀ-ÿ-]+$/, '');
}

// A gloss that is ONLY a grammatical-form label (e.g. "third-person singular present
// indicative") carries no meaning and no "of <lemma>" to follow, so it is useless as a
// definition. Detect these so they can be dropped, leaving the meaning-bearing senses.
const GRAMMAR_LABEL_TOKENS = new Set([
  'first', 'second', 'third', 'person', 'singular', 'plural',
  'masculine', 'feminine', 'neuter', 'gender', 'number',
  'present', 'past', 'preterite', 'preterit', 'future', 'imperfect', 'perfect', 'pluperfect',
  'indicative', 'subjunctive', 'imperative', 'conditional', 'infinitive', 'gerund',
  'participle', 'supine', 'tense', 'mood', 'form',
]);

export function isInflectionLabelOnly(gloss) {
  if (/\bof\b/i.test(gloss)) return false; // references a lemma — handled by form-of resolution
  const tokens = gloss.toLowerCase().split(/[\s,;/-]+/).filter(Boolean);
  if (tokens.length < 2) return false; // single words can be real meanings ("present", "perfect")
  return tokens.every((t) => GRAMMAR_LABEL_TOKENS.has(t));
}

/**
 * Classify senses into real definitions vs form-of references.
 * Returns { real, formOf, primaryLemma } where primaryLemma is the
 * accent-folded key of the first referenced lemma (or null).
 */
function classifySenses(senses) {
  const real = [];
  const formOf = [];
  const lemmaRefs = [];

  for (const s of senses) {
    const m = FORM_OF_RE.exec(s.gloss);
    if (m) {
      const cleaned = cleanLemmaRef(m[1]);
      if (cleaned) lemmaRefs.push(cleaned);
      formOf.push(s);
    } else {
      real.push(s);
    }
  }

  // Keep the lemma as written in the gloss (accents intact) for display; fold only for the DB key.
  const primaryRef = lemmaRefs.length > 0 ? lemmaRefs[0] : null;
  return {
    real,
    formOf,
    primaryLemma: primaryRef ? accentFoldKey(primaryRef) : null,
    primaryLemmaDisplay: primaryRef,
  };
}

export async function fetchWiktSenses(word, targetLang, _nativeLang) {
  const rows = await queryWiktionary(word, targetLang);
  // Drop senses that are only grammatical-form labels with no meaning (e.g. "second-person
  // singular imperative"), leaving the picker meaning-bearing senses.
  const senses = flattenSenses(rows).filter((s) => !isInflectionLabelOnly(s.gloss));

  // Expand form-of senses by looking up the lemma
  const { real, formOf, primaryLemma, primaryLemmaDisplay } = classifySenses(senses);
  if (primaryLemma && formOf.length > 0) {
    const lemmaRows = await queryWiktionary(primaryLemma, targetLang);
    const lemmaSenses = flattenSenses(lemmaRows).filter((s) => !isInflectionLabelOnly(s.gloss));
    if (lemmaSenses.length > 0) {
      const lemmaWord = primaryLemmaDisplay; // accented lemma as written in the gloss
      // Filter lemma senses by POS of the form-of entries
      const posSet = new Set(formOf.map(s => s.pos));
      const filtered = lemmaSenses.filter(s => posSet.has(s.pos));
      // Tag senses pulled in from the lemma so a caller can tell, per picked sense,
      // whether the word is actually an inflected form of `lemmaWord` (vs. one of its
      // own real senses — e.g. "mas" the conjunction shares a list with "más" = form of mau).
      const replacement = (filtered.length > 0 ? filtered : lemmaSenses).map(s => ({ ...s, lemma: lemmaWord }));
      const expanded = [...real, ...replacement];
      logger.info('[wikt-lemma] %s → %s (%s), expanded: %d real + %d from lemma', word, lemmaWord, formOf[0].gloss, real.length, replacement.length);
      return { senses: expanded, resolvedLemma: lemmaWord };
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
export const FIELD_IMAGE_TERM = `- IMAGE_TERM: A short English stock-photo search term for a flashcard image of this word in the sense used. Always English. Guidelines:
  - Prefer the SIMPLEST term that works — usually just the plain English translation ("baile" → "dance", "perro" → "dog", "montañoso" → "mountain"). A broad term finds better, more varied photos, so do NOT add needless specificity (use "dance", not "couple dancing salsa").
  - Add detail ONLY when the sense needs pinning down ("banco" money → "bank building"; "bat" sport → "baseball bat").
  - For abstract words that have a clear conventional visual, use that one concrete subject ("freedom" → "bird leaving cage"; "nostalgia" → "old photographs"). Keep it to the single most typical image, not an elaborate scene, and don't borrow specifics from the example sentence.
  - Avoid terms that return diagrams, charts, maps, logos, or images full of text (for "level" use "water in glass", not "levels diagram").
  - Never return an empty string.`;
const FIELD_LEMMA = `- LEMMA: The dictionary/base form of this word in the target language.
  For verbs: the infinitive (e.g. "to work" in English, "trabajar" in Spanish).
  For nouns: the singular (e.g. "cat" not "cats").
  For adjectives/adverbs: the positive form (e.g. "big" not "bigger").
  If the word is already its base form, return it unchanged. Leave empty for
  particles, prepositions, conjunctions, and other uninflected words.`;

async function describeFlashcardImage({ word, definition, image }) {
  if (!image?.buffer || !image?.contentType) return { description: null, failure: null };

  try {
    const raw = await callGeminiVision(
      [
        {
          text: `This image was chosen for a language-learning flashcard for "${word}"` +
            (definition ? ` (meaning: ${definition})` : '') + `. ` +
            `Describe what is visibly happening in the image in one short English phrase or sentence. ` +
            `Focus on concrete subjects, actions, setting, and mood that could naturally appear in an example sentence. ` +
            `Do not mention the word "image", "photo", "illustration", or any uncertainty.`,
        },
        { inlineData: { mimeType: image.contentType, data: image.buffer.toString('base64') } },
      ],
      { maxOutputTokens: 80, temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
    );
    const description = raw.trim().replace(/^["']|["']$/g, '');
    if (!description) {
      return {
        description: null,
        failure: 'Image scene description returned no usable description.',
      };
    }
    return { description, failure: null };
  } catch (err) {
    logger.error('describeFlashcardImage failed for "%s": %s', word, err.message);
    return {
      description: null,
      failure: `Image scene description failed: ${err.message}`,
    };
  }
}

function ensureMarkedExample(sentence, word) {
  if (!sentence) return null;
  if (sentence.includes('~')) return sentence;
  const escaped = String(word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return sentence;
  const marked = sentence.replace(new RegExp(`\\b(${escaped})\\b`, 'iu'), '~$1~');
  return marked.includes('~') ? marked : null;
}

async function generateImageGroundedExample({
  word,
  targetLang,
  nativeLang,
  translation,
  definition,
  partOfSpeech,
  imageContext,
}) {
  const prompt = `A language learner is saving the ${targetLang || 'target-language'} word "${word}".
Native language: ${nativeLang}
Word translation: ${translation || ''}
Definition: ${definition || ''}
Part of speech: ${partOfSpeech || ''}
${imageContext ? `Chosen flashcard image scene: ${imageContext}` : 'No usable image scene description is available. Base the example on the definition.'}

Create the INITIAL flashcard example sentence${imageContext ? ' so it matches what is visibly happening in the chosen image' : ' using the word in the stated sense'}.
Return ONLY JSON with exactly these keys:
{"example_sentence":"...","sentence_translation":"..."}

Rules:
- example_sentence must be a short, natural beginner-level sentence in ${targetLang || 'the target language'}.
- It must use "${word}" in the same sense as the definition.
${imageContext ? '- It must describe or fit the chosen image scene. Do not introduce unrelated objects or actions.' : '- Keep the situation concrete, ordinary, and easy to understand.'}
- Wrap the target word, or the exact inflected form used, with tildes like ~word~.
- Keep example_sentence under 15 words.
- sentence_translation must be a natural ${nativeLang} translation of the example sentence.
- In sentence_translation, wrap the translated equivalent of the target word with tildes.`;

  try {
    const raw = await callGemini(
      prompt,
      {
        thinkingConfig: { thinkingBudget: 0 },
        // Generous cap: a truncated response is unparseable JSON, which was the
        // most common cause of the example-generation fallback.
        maxOutputTokens: 400,
        responseMimeType: 'application/json',
      },
    );
    const parsed = parseGeminiJson(raw, 'Image-grounded example generation');
    const example = ensureMarkedExample(String(parsed.example_sentence || '').trim(), word);
    const sentenceTranslation = String(parsed.sentence_translation || '').trim() || null;
    if (!example) {
      return { result: null, failure: 'Example generation returned an empty or invalid sentence.' };
    }
    return {
      result: { example_sentence: example, sentence_translation: sentenceTranslation },
      failure: null,
    };
  } catch (err) {
    logger.error('generateImageGroundedExample failed for "%s": %s', word, err.message);
    return {
      result: null,
      failure: `Example generation failed: ${err.message}`,
    };
  }
}

async function generateExampleSentenceTranslation({
  word,
  targetLang,
  nativeLang,
  exampleSentence,
}) {
  if (!exampleSentence) return { translation: null, failure: null };

  const prompt = `Translate this ${targetLang || 'target-language'} flashcard example sentence into ${nativeLang}.

The target word or inflected form is wrapped in tildes in the source sentence. In your translation, wrap only the natural ${nativeLang} equivalent of that marked word or phrase in tildes.

Return ONLY JSON with exactly this key:
{"sentence_translation":"..."}

Source sentence: ${exampleSentence}
Target word: ${word}`;

  try {
    const raw = await callGemini(
      prompt,
      {
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 120,
        responseMimeType: 'application/json',
      },
    );
    const parsed = parseGeminiJson(raw, 'Example sentence translation');
    const translation = String(parsed.sentence_translation || '').trim();
    if (!translation) {
      return { translation: null, failure: 'Example sentence translation returned no usable text.' };
    }
    return { translation, failure: null };
  } catch (err) {
    logger.error('generateExampleSentenceTranslation failed for "%s": %s', word, err.message);
    return {
      translation: null,
      failure: `Example sentence translation failed: ${err.message}`,
    };
  }
}

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
export async function enrichWord(word, sentence, nativeLang, targetLang, senseIndex = null, options = {}) {
  const _t0 = Date.now();
  const fallback_notices = [];
  const definitionHint = options.matched_gloss || options.definition || null;
  const partOfSpeechHint = options.part_of_speech || null;
  let definitionSource = options.definition_source || null;
  let matchedGloss = options.matched_gloss || null;
  let resolvedSenseIndex = typeof senseIndex === 'number' ? senseIndex : null;

  async function getCached(definitionValue, posValue, cacheWord = word) {
    const shared = await findSharedEntry({
      word: cacheWord,
      target_language: targetLang,
      definition: definitionValue,
      part_of_speech: posValue,
    });
    if (!shared) return null;
    logger.info('[enrich-cache] %s/%s — shared entry hit %s', targetLang, cacheWord, shared.id);
    return sharedEntryToEnrichment(shared);
  }

  if (definitionHint) {
    const cached = await getCached(definitionHint, partOfSpeechHint);
    if (cached) return cached;
  }

  // Query Wiktionary DB directly — gives access to both senses AND forms
  let wiktRows = targetLang
    ? await queryWiktionary(word, targetLang)
    : [];
  let wiktSenses = flattenSenses(wiktRows);

  // Expand form-of senses by looking up the lemma
  let wiktResolvedLemma = null;
  const { real, formOf, primaryLemma } = classifySenses(wiktSenses);
  if (primaryLemma && formOf.length > 0) {
    const lemmaRows = await queryWiktionary(primaryLemma, targetLang);
    const lemmaSenses = flattenSenses(lemmaRows);
    if (lemmaSenses.length > 0) {
      wiktResolvedLemma = lemmaRows[0]?.word || primaryLemma;
      // Filter lemma senses by POS of the form-of entries
      const posSet = new Set(formOf.map(s => s.pos));
      const filtered = lemmaSenses.filter(s => posSet.has(s.pos));
      const replacement = filtered.length > 0 ? filtered : lemmaSenses;

      if (real.length === 0) {
        // All form-of: replace rows entirely (for forms lookup too)
        wiktRows = lemmaRows;
        wiktSenses = replacement;
      } else {
        // Mixed: keep real senses, add lemma senses, keep original rows for forms
        wiktSenses = [...real, ...replacement];
      }
      logger.info('[enrich-lemma] %s → %s (%s), expanded: %d real + %d from lemma', word, wiktResolvedLemma, formOf[0].gloss, real.length, replacement.length);
    }
  }
  const _t1 = Date.now();
  logger.info('[enrich-timing] %s — Wiktionary DB: %dms (found %d senses)', word, _t1 - _t0, wiktSenses.length);

  let translation, definition, part_of_speech, frequency, example_sentence, sentence_translation, geminiImageTerm, lemma;

  if (definitionHint) {
    definition = definitionHint;
    part_of_speech = partOfSpeechHint;
    if (!definitionSource) definitionSource = matchedGloss ? 'wiktionary' : 'user';

    const prompt = buildEnrichPrompt({
      word, sentence, nativeLang, targetLang,
      fieldNames: 'TRANSLATION // FREQUENCY // IMAGE_TERM // LEMMA',
      extraFieldDescs: '',
      contextLine: `The word means: "${definition}" (${part_of_speech || 'unknown POS'}).`,
      senseListBlock: '',
    });

    const raw = await callGemini(prompt);
    const _t2 = Date.now();
    logger.info('[enrich-timing] %s — Gemini (definition hint): %dms', word, _t2 - _t1);
    const parts = raw.split('//').map((s) => s.trim());
    if (parts.length < 4) {
      throw new Error(`Gemini enrich returned ${parts.length} parts instead of 4 for the definition-hint path`);
    }

    translation = parts[0] || '';
    frequency = parseFrequency(parts[1]);
    geminiImageTerm = parts[2]?.trim() || null;
    lemma = parts[3]?.trim() || null;
  }

  // Path C: senseIndex pre-identified by /lookup — use directly, skip sense-picking
  const hasSenseIndex = typeof senseIndex === 'number' && senseIndex >= 0;
  if (translation === undefined && hasSenseIndex && wiktSenses.length > 0 && senseIndex < wiktSenses.length) {
    definition = wiktSenses[senseIndex].gloss;
    part_of_speech = wiktSenses[senseIndex].pos || null;
    definitionSource = definitionSource || 'wiktionary';
    matchedGloss = matchedGloss || definition;

    const cached = await getCached(definition, part_of_speech);
    if (cached) return cached;

    const prompt = buildEnrichPrompt({
      word, sentence, nativeLang, targetLang,
      fieldNames: 'TRANSLATION // FREQUENCY // IMAGE_TERM // LEMMA',
      extraFieldDescs: '',
      contextLine: `The word means: "${definition}" (${part_of_speech || 'unknown POS'}).`,
      senseListBlock: '',
    });

    const raw = await callGemini(prompt);
    const _t2 = Date.now();
    logger.info('[enrich-timing] %s — Gemini (Path C): %dms', word, _t2 - _t1);
    const parts = raw.split('//').map((s) => s.trim());
    if (parts.length < 4) {
      throw new Error(`Gemini enrich returned ${parts.length} parts instead of 4 for Path C`);
    }

    translation = parts[0] || '';
    frequency = parseFrequency(parts[1]);
    geminiImageTerm = parts[2]?.trim() || null;
    lemma = parts[3]?.trim() || null;
  } else if (translation === undefined && hasSenseIndex && (wiktSenses.length === 0 || senseIndex >= wiktSenses.length)) {
    throw new Error(`Sense index ${senseIndex} is invalid for ${wiktSenses.length} available senses`);
  }

  // Path A/B: only run if Path C didn't set translation (i.e. it was skipped)
  if (translation === undefined) {
    if (wiktSenses.length > 0) {
      // Path A: Wiktionary senses available — ask Gemini to pick the best one
      const senseList = wiktSenses.map((s, i) => `${i}: [${s.pos}] ${s.gloss}`).join('\n');

      const prompt = buildEnrichPrompt({
        word, sentence, nativeLang, targetLang,
        fieldNames: 'TRANSLATION // SENSE_INDEX // FREQUENCY // IMAGE_TERM // FALLBACK_DEFINITION // LEMMA',
        extraFieldDescs: `- SENSE_INDEX: The integer index (0-${wiktSenses.length - 1}) of the sense that best matches how "${word}" is used in the sentence. If NONE of the senses match, return -1.\n- FALLBACK_DEFINITION: A brief explanation of how this word is used in the given sentence, in ${nativeLang}. 15 words max. No markdown. Used when SENSE_INDEX is -1.\n`,
        contextLine: '',
        senseListBlock: `\nHere are the dictionary senses for "${word}":\n${senseList}\n`,
      });

      const raw = await callGemini(prompt);
      const _t2 = Date.now();
      logger.info('[enrich-timing] %s — Gemini (Path A): %dms', word, _t2 - _t1);

      const parts = raw.split('//').map((s) => s.trim());
      if (parts.length < 6) {
        throw new Error(`Gemini enrich returned ${parts.length} parts instead of 6 for the Wiktionary path`);
      }

      translation = parts[0] || '';

      // Resolve definition + POS from sense index
      resolvedSenseIndex = parseInt(parts[1], 10);
      if (!isNaN(resolvedSenseIndex) && resolvedSenseIndex >= 0 && resolvedSenseIndex < wiktSenses.length) {
        definition = wiktSenses[resolvedSenseIndex].gloss;
        part_of_speech = wiktSenses[resolvedSenseIndex].pos || null;
        definitionSource = 'wiktionary';
        matchedGloss = definition;
      } else {
        // No matching sense — use Gemini's fallback definition
        definition = parts[4]?.trim() || '';
        definitionSource = 'gemini';
        logger.info('[enrich] %s — no Wiktionary sense matched (index=%s), using Gemini fallback: "%s"', word, parts[1], definition);
        fallback_notices.push({
          title: 'Gemini fallback used',
          message: `No Wiktionary sense matched "${word}" in context, so Polycast used Gemini's definition.`,
        });
        if (definition && targetLang) {
          persistGeminiFallbackSense({ word, lang: targetLang, pos: wiktSenses[0]?.pos || 'unknown', definition });
        }
      }

      frequency = parseFrequency(parts[2]);
      geminiImageTerm = parts[3]?.trim() || null;
      lemma = parts[5]?.trim() || null;
    } else {
      // Path B: No Wiktionary senses — full Gemini generation
      const prompt = buildEnrichPrompt({
        word, sentence, nativeLang, targetLang,
        fieldNames: 'TRANSLATION // DEFINITION // PART_OF_SPEECH // FREQUENCY // IMAGE_TERM // LEMMA',
        extraFieldDescs: `- DEFINITION: A brief explanation of how this word is used in the given sentence, in ${nativeLang}. 15 words max. No markdown.\n- PART_OF_SPEECH: One of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle. Lowercase English.\n`,
        contextLine: '',
        senseListBlock: '',
      });

      const raw = await callGemini(prompt);
      const _t2 = Date.now();
      logger.info('[enrich-timing] %s — Gemini (Path B): %dms', word, _t2 - _t1);

      const parts = raw.split('//').map((s) => s.trim());
      if (parts.length < 6) {
        throw new Error(`Gemini enrich returned ${parts.length} parts instead of 6 for the direct generation path`);
      }
      translation = parts[0] || '';
      definition = parts[1] || '';
      part_of_speech = parts[2] || null;
      definitionSource = 'gemini';
      fallback_notices.push({
        title: 'Gemini fallback used',
        message: `No Wiktionary definition was available for "${word}", so Polycast used Gemini.`,
      });
      frequency = parseFrequency(parts[3]);
      geminiImageTerm = parts[4]?.trim() || null;
      lemma = parts[5]?.trim() || null;

      if (definition && part_of_speech && targetLang) {
        persistGeminiFallbackSense({ word, lang: targetLang, pos: part_of_speech, definition });
      }
    }
  } // end if (translation === undefined) — Path A/B

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

  // Lemma-level corpus frequency from wordfreq's blended Zipf data: sum the per-billion
  // frequencies of every inflected form so the value reflects the whole paradigm and is the
  // same no matter which conjugation was clicked. frequency_count = occurrences per billion.
  const corpusFreq = applyCorpusFrequency(word, targetLang, frequency, { lemma, forms });
  frequency = corpusFreq.frequency;
  const frequency_count = corpusFreq.frequency_count;

  const cacheWord = lemma || word;
  const cachedBeforeImage = await getCached(definition, part_of_speech, cacheWord);
  if (cachedBeforeImage) return cachedBeforeImage;

  // Image: search several candidates and let Gemini vision pick the best fit —
  // the picker is the single arbiter of whether anything fits. If nothing does,
  // generate one. Then cache the bytes so the flashcard never depends on a
  // rotting upstream stock-photo link.
  const imageSearchTerm = geminiImageTerm || translation || word;
  const _tImg0 = Date.now();
  const candidates = await searchAllImages(imageSearchTerm, 4, {
    onFallback: (diagnostic) => fallback_notices.push(diagnostic),
  }); // up to ~8 (Pixabay + Wikimedia)
  let chosen = candidates.length
    ? await pickBestImage({ word, definition, sentence, candidates })
    : null;
  let imageSource = 'stock';
  if (!chosen) {
    if (candidates.length > 0) {
      fallback_notices.push({
        title: 'Image fallback used',
        message: `No stock image clearly matched "${word}", so Polycast generated one instead.`,
      });
    } else {
      fallback_notices.push({
        title: 'Image fallback used',
        message: `Image search returned no candidates for "${imageSearchTerm}", so Polycast generated an image instead.`,
      });
    }
    chosen = await generateWordImage(word, definition, { sentence, imageTerm: imageSearchTerm });
    imageSource = 'generated';
  }
  let image_url = null;
  let imageContext = chosen?.sceneDescription || null;
  if (chosen) {
    if (chosen.fallbackNotice) {
      fallback_notices.push(chosen.fallbackNotice);
    }
    if (!imageContext) {
      if (imageSource === 'stock') {
        fallback_notices.push({
          title: 'Image description fallback used',
          message: `The combined image picker did not return a scene description for "${word}", so Polycast ran a separate vision description.`,
        });
      }
      const imageDescription = await describeFlashcardImage({ word, definition, image: chosen });
      imageContext = imageDescription.description;
      if (imageDescription.failure) {
        fallback_notices.push({
          title: 'Image description fallback failed',
          message: `${imageDescription.failure} The example will be generated from the definition instead of the image.`,
        });
      }
    }

    const id = await storeImageBytes(chosen.buffer, chosen.contentType, chosen.url ?? null);
    image_url = `/api/dictionary/image/${id}`;
  } else {
    fallback_notices.push({
      title: 'Image unavailable',
      message: `Polycast could not find or generate an image for "${word}". Keeping the text-only flashcard data.`,
    });
    logger.warn('enrichWord: no image found or generated for "%s" (term "%s")', word, imageSearchTerm);
  }

  if (!imageContext) {
    fallback_notices.push({
      title: 'Example fallback used',
      message: `No usable image scene was available for "${word}", so Polycast generated the example from its definition.`,
    });
  }

  const generatedExample = await generateImageGroundedExample({
    word,
    targetLang,
    nativeLang,
    translation,
    definition,
    partOfSpeech: part_of_speech,
    imageContext,
  });
  if (generatedExample.result) {
    example_sentence = generatedExample.result.example_sentence;
    sentence_translation = generatedExample.result.sentence_translation;
    logger.info('[enrich] %s — generated example: "%s"', word, example_sentence);
  } else {
    const sourceSentence = ensureMarkedExample(String(sentence || '').trim(), word);
    example_sentence = sourceSentence;
    sentence_translation = null;
    fallback_notices.push({
      title: 'Example fallback used',
      message: sourceSentence
        ? `${generatedExample.failure || 'Example generation returned no result.'} Using the learner's source sentence.`
        : `${generatedExample.failure || 'Example generation returned no result.'} No valid source sentence was available, so the word was saved without an example.`,
    });
  }

  if (example_sentence && !sentence_translation) {
    const generatedTranslation = await generateExampleSentenceTranslation({
      word,
      targetLang,
      nativeLang,
      exampleSentence: example_sentence,
    });
    if (generatedTranslation.translation) {
      sentence_translation = generatedTranslation.translation;
      logger.info('[enrich] %s — generated missing sentence translation: "%s"', word, sentence_translation);
    } else if (generatedTranslation.failure) {
      fallback_notices.push({
        title: 'Sentence translation fallback failed',
        message: `${generatedTranslation.failure} The flashcard was saved without a sentence translation.`,
      });
    }
  }

  const _tImg1 = Date.now();
  logger.info('[enrich-timing] %s — Image %s ("%s"): %dms', word, imageSource, imageSearchTerm, _tImg1 - _tImg0);
  logger.info('[enrich-timing] %s — TOTAL: %dms', word, _tImg1 - _t0);

  const image_term = geminiImageTerm || translation || word;
  const result = {
    word,
    translation,
    definition,
    part_of_speech,
    frequency,
    frequency_count,
    example_sentence,
    sentence_translation,
    image_url,
    lemma,
    forms,
    image_term,
    fallback_notices,
    shared_entry_id: null,
    compendium_hit: false,
  };

  try {
    const sharedEntry = await storeSharedEntry({
      ...result,
      word: cacheWord,
      target_language: targetLang,
      definition_source: definitionSource,
      matched_gloss: matchedGloss,
      sense_index: resolvedSenseIndex,
    });
    if (sharedEntry) result.shared_entry_id = sharedEntry.id;
  } catch (err) {
    logger.error({ err }, '[enrich-cache] failed to store shared entry for %s/%s', targetLang, cacheWord);
  }

  return result;
}
