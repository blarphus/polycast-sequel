/**
 * enrichWord.js — shared word enrichment logic.
 * Used by both the dictionary route (POST /api/dictionary/enrich)
 * and the stream route (POST /api/stream/posts) at word-list creation time.
 */

import { applyCorpusFrequency } from './lib/wordFrequency.js';
import { normalizeForms, normalizeLemma } from './lib/normalizeWordFields.js';
import logger from './logger.js';

const API_HEADERS = { 'User-Agent': 'Polycast/1.0' };

export async function searchPixabay(query, perPage = 3) {
  const pixabayKey = process.env.PIXABAY_API_KEY;
  if (!pixabayKey) {
    logger.error('PIXABAY_API_KEY is not set — skipping Pixabay search');
    return [];
  }
  const params = new URLSearchParams({
    key: pixabayKey,
    q: query,
    image_type: 'photo',
    per_page: String(perPage),
    safesearch: 'true',
  });
  const res = await fetch(`https://pixabay.com/api/?${params}`);
  if (!res.ok) {
    logger.error('Pixabay search failed: %d', res.status);
    return [];
  }
  const data = await res.json();
  return (data.hits || []).map(h => h.webformatURL);
}

async function searchWikimedia(query, limit = 5) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '640',
    format: 'json',
    origin: '*',
  });
  try {
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: API_HEADERS,
    });
    if (!res.ok) {
      logger.error('Wikimedia search failed: %d', res.status);
      return [];
    }
    const data = await res.json();
    const pages = data.query?.pages || {};
    return Object.values(pages)
      .map(p => p.imageinfo?.[0]?.thumburl)
      .filter(Boolean);
  } catch (err) {
    logger.error({ err }, 'Wikimedia search error');
    return [];
  }
}

export async function searchAllImages(query, perPage = 5) {
  const [pixabay, wikimedia] = await Promise.all([
    searchPixabay(query, perPage),
    searchWikimedia(query, perPage),
  ]);
  // Interleave results from both sources
  const images = [];
  const maxLen = Math.max(pixabay.length, wikimedia.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < pixabay.length) images.push(pixabay[i]);
    if (i < wikimedia.length) images.push(wikimedia[i]);
  }
  return images;
}

export async function fetchWordImage(searchTerm, excludeUrls = null) {
  try {
    const urls = await searchAllImages(searchTerm, 5);
    if (excludeUrls) {
      return urls.find(u => !excludeUrls.has(u)) || null;
    }
    return urls[0] || null;
  } catch (err) {
    logger.error({ err }, 'fetchWordImage error');
    return null;
  }
}

function parseFrequency(str) {
  if (!str) return null;
  const n = parseInt(str, 10);
  if (isNaN(n)) {
    logger.error('Gemini enrich returned non-numeric frequency: %s', str);
    return null;
  }
  return n;
}

export async function callGemini(prompt, generationConfig = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
    },
  );

  if (!response.ok) {
    const errBody = await response.text();
    logger.error('Gemini API error: %s', errBody);
    throw new Error('Gemini request failed');
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    logger.error('Gemini API returned no text content: %s', JSON.stringify(data).slice(0, 500));
    throw new Error('Gemini returned no text content');
  }
  return text;
}

export async function streamGemini(
  prompt,
  {
    generationConfig = {},
    signal,
    onText,
  } = {},
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal,
    },
  );

  if (!response.ok) {
    const errBody = await response.text();
    logger.error('Gemini streaming API error: %s', errBody);
    throw new Error('Gemini streaming request failed');
  }

  if (!response.body) {
    throw new Error('Gemini streaming response had no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  const flushEvents = () => {
    let boundaryMatch = buffer.match(/\r?\n\r?\n/);
    while (boundaryMatch) {
      const boundaryIndex = boundaryMatch.index ?? -1;
      const eventBlock = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + boundaryMatch[0].length);

      const dataLines = eventBlock
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());

      if (!dataLines.length) continue;

      const payload = JSON.parse(dataLines.join('\n'));
      const text = payload.candidates?.[0]?.content?.parts
        ?.map((part) => part?.text || '')
        .join('') || '';

      if (!text) continue;
      fullText += text;
      if (onText) {
        onText(text);
      }

      boundaryMatch = buffer.match(/\r?\n\r?\n/);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    flushEvents();
    if (done) break;
  }

  if (buffer.trim()) {
    flushEvents();
  }

  return fullText;
}

const WIKT_EDITIONS = new Set([
  'cs','de','el','en','es','fr','id','it','ja','ko',
  'ku','ms','nl','pl','pt','ru','th','tr','vi','zh',
]);

export async function fetchWiktSenses(word, targetLang, nativeLang) {
  const edition = WIKT_EDITIONS.has(nativeLang) ? nativeLang : 'en';
  const url = `https://api.wiktapi.dev/v1/${edition}/word/${encodeURIComponent(word)}/definitions?lang=${targetLang}`;
  const response = await fetch(url, { headers: API_HEADERS });

  if (response.status === 404) return [];
  if (!response.ok) {
    logger.error('WiktApi error: %d %s', response.status, await response.text().catch(() => ''));
    return [];
  }

  const data = await response.json();
  const senses = [];
  for (const entry of data.definitions || []) {
    const pos = entry.pos || '';
    for (const sense of entry.senses || []) {
      if ((sense.tags || []).includes('form-of')) continue;
      const firstExample = (sense.examples || []).find(e => e.type === 'example') || null;
      let example = null;
      if (firstExample) {
        let text = firstExample.text;
        const offsets = (firstExample.bold_text_offsets || []).slice().sort((a, b) => b[0] - a[0]);
        for (const [start, end] of offsets) {
          text = text.slice(0, start) + '~' + text.slice(start, end) + '~' + text.slice(end);
        }
        example = { text, translation: firstExample.translation || firstExample.english || null };
      }
      for (const gloss of sense.glosses || []) {
        if (!gloss) continue;
        senses.push({ gloss, pos, tags: sense.tags || [], example });
      }
    }
  }
  return senses;
}

export async function fetchWiktTranslations(word, nativeLang) {
  const url = `https://api.wiktapi.dev/v1/en/word/${encodeURIComponent(word)}/translations?lang=en`;
  const response = await fetch(url, { headers: API_HEADERS });

  if (response.status === 404) return [];
  if (!response.ok) {
    logger.error('WiktApi translations error: %d %s', response.status, await response.text().catch(() => ''));
    return [];
  }

  const data = await response.json();

  // Collect ALL unique senses; words[] only populated for native language
  const sensesMap = new Map();
  for (const posGroup of data.translations || []) {
    const pos = posGroup.pos || '';
    for (const entry of posGroup.translations || []) {
      const key = entry.sense || '';
      if (!sensesMap.has(key)) {
        sensesMap.set(key, { sense: key, pos, words: [] });
      }
      if (entry.code === nativeLang && entry.word) {
        sensesMap.get(key).words.push(entry.word);
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
const FIELD_IMAGE_TERM = `- IMAGE_TERM: An English search term for finding a photo of this word. Return an empty string if the word itself is already a clear, concrete, unambiguous noun that would return good image results (e.g. "cat", "bridge", "apple" → empty string). Only provide a custom term when: (1) the word has multiple common meanings and the image search might return the wrong one (e.g. "bat" in a sports unit → "baseball bat"), (2) the word is abstract/unlikely to have good photo results (e.g. "freedom" → "open bird cage"), or (3) the word is a verb/adjective that needs a visual representation (e.g. "fragile" → "cracked glass"). Keep it 1-4 words.`;
const FIELD_LEMMA = `- LEMMA: The dictionary/base form of this word in the target language.
  For verbs: the infinitive (e.g. "to work" in English, "trabajar" in Spanish).
  For nouns: the singular (e.g. "cat" not "cats").
  For adjectives/adverbs: the positive form (e.g. "big" not "bigger").
  If the word is already its base form, return it unchanged. Leave empty for
  particles, prepositions, conjunctions, and other uninflected words.`;
const FIELD_FORMS = `- FORMS: Comma-separated list of all inflected forms of the LEMMA.
  Verbs: all conjugations (e.g. "run, runs, ran, running").
  Nouns: singular and plural (e.g. "cat, cats").
  Adjectives/adverbs: all degrees (e.g. "big, bigger, biggest").
  Leave empty for particles, prepositions, conjunctions, and other uninflected words.`;

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
${FIELD_LEMMA}
${FIELD_FORMS}`;
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
  // Try to fetch Wiktionary senses for standardized definitions
  let wiktSenses = [];
  if (targetLang) {
    try {
      wiktSenses = await fetchWiktSenses(word, targetLang, nativeLang);
    } catch (err) {
      logger.error({ err }, 'fetchWiktSenses error in enrich');
    }
  }

  let translation, definition, part_of_speech, frequency, example_sentence, sentence_translation, geminiImageTerm, lemma, geminiFormsRaw;

  // Path C: senseIndex pre-identified by /lookup — use directly, skip sense-picking
  const hasSenseIndex = typeof senseIndex === 'number' && senseIndex >= 0;
  if (hasSenseIndex && wiktSenses.length > 0 && senseIndex < wiktSenses.length) {
    definition = wiktSenses[senseIndex].gloss;
    part_of_speech = wiktSenses[senseIndex].pos || null;

    const prompt = buildEnrichPrompt({
      word, sentence, nativeLang, targetLang,
      fieldNames: 'TRANSLATION // FREQUENCY // EXAMPLE // SENTENCE_TRANSLATION // IMAGE_TERM // LEMMA // FORMS',
      extraFieldDescs: '',
      contextLine: `The word means: "${definition}" (${part_of_speech || 'unknown POS'}).`,
      senseListBlock: '',
    });

    const raw = await callGemini(prompt);
    const parts = raw.split('//').map((s) => s.trim());
    if (parts.length < 7) {
      logger.error('Gemini enrich (Path C) returned %d parts instead of 7: %s', parts.length, raw.slice(0, 300));
    }

    translation = parts[0] || '';
    frequency = parseFrequency(parts[1]);
    example_sentence = parts[2] || null;
    sentence_translation = parts[3] || null;
    geminiImageTerm = parts[4]?.trim() || null;
    lemma = parts[5]?.trim() || null;
    geminiFormsRaw = parts[6]?.trim() || null;
  } else if (hasSenseIndex && (wiktSenses.length === 0 || senseIndex >= wiktSenses.length)) {
    // senseIndex provided but invalid (senses changed between lookup and enrich) — fall through
    logger.error('enrich: senseIndex %d out of range for %d senses — falling through to Path A/B', senseIndex, wiktSenses.length);
  }

  // Path A/B: only run if Path C didn't set translation (i.e. it was skipped)
  if (translation === undefined) {
    if (wiktSenses.length > 0) {
      // Path A: Wiktionary senses available — ask Gemini to pick the best one
      const senseList = wiktSenses.map((s, i) => `${i}: [${s.pos}] ${s.gloss}`).join('\n');

      const prompt = buildEnrichPrompt({
        word, sentence, nativeLang, targetLang,
        fieldNames: 'TRANSLATION // SENSE_INDEX // FREQUENCY // EXAMPLE // SENTENCE_TRANSLATION // IMAGE_TERM // FALLBACK_DEFINITION // LEMMA // FORMS',
        extraFieldDescs: `- SENSE_INDEX: The integer index (0-${wiktSenses.length - 1}) of the sense that best matches how "${word}" is used in the sentence.\n- FALLBACK_DEFINITION: A brief explanation of how this word is used in the given sentence, in ${nativeLang}. 15 words max. No markdown. Only used if SENSE_INDEX is invalid.\n`,
        contextLine: '',
        senseListBlock: `\nHere are the dictionary senses for "${word}":\n${senseList}\n`,
      });

      const raw = await callGemini(prompt);

      const parts = raw.split('//').map((s) => s.trim());
      if (parts.length < 9) {
        logger.error('Gemini enrich (wikt) returned %d parts instead of 9: %s', parts.length, raw.slice(0, 300));
      }

      translation = parts[0] || '';

      // Resolve definition + POS from sense index
      const resolvedSenseIndex = parseInt(parts[1], 10);
      if (!isNaN(resolvedSenseIndex) && resolvedSenseIndex >= 0 && resolvedSenseIndex < wiktSenses.length) {
        definition = wiktSenses[resolvedSenseIndex].gloss;
        part_of_speech = wiktSenses[resolvedSenseIndex].pos || null;
      } else {
        logger.error('Gemini returned invalid SENSE_INDEX: %s (valid: 0-%d)', parts[1], wiktSenses.length - 1);
        definition = parts[6] || '';
        part_of_speech = null;
      }

      frequency = parseFrequency(parts[2]);
      example_sentence = parts[3] || null;
      sentence_translation = parts[4] || null;
      geminiImageTerm = parts[5]?.trim() || null;
      lemma = parts[7]?.trim() || null;
      geminiFormsRaw = parts[8]?.trim() || null;
    } else {
      // Path B: No Wiktionary senses — full Gemini generation
      const prompt = buildEnrichPrompt({
        word, sentence, nativeLang, targetLang,
        fieldNames: 'TRANSLATION // DEFINITION // PART_OF_SPEECH // FREQUENCY // EXAMPLE // SENTENCE_TRANSLATION // IMAGE_TERM // LEMMA // FORMS',
        extraFieldDescs: `- DEFINITION: A brief explanation of how this word is used in the given sentence, in ${nativeLang}. 15 words max. No markdown.\n- PART_OF_SPEECH: One of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle. Lowercase English.\n`,
        contextLine: '',
        senseListBlock: '',
      });

      const raw = await callGemini(prompt);

      const parts = raw.split('//').map((s) => s.trim());
      if (parts.length < 9) {
        logger.error('Gemini enrich returned %d parts instead of 9: %s', parts.length, raw.slice(0, 300));
      }
      translation = parts[0] || '';
      definition = parts[1] || '';
      part_of_speech = parts[2] || null;
      frequency = parseFrequency(parts[3]);
      example_sentence = parts[4] || null;
      sentence_translation = parts[5] || null;
      geminiImageTerm = parts[6]?.trim() || null;
      lemma = parts[7]?.trim() || null;
      geminiFormsRaw = parts[8]?.trim() || null;
    }
  } // end if (translation === undefined) — Path A/B

  // For English target words, override Gemini frequency with SUBTLEX-US corpus data
  const corpusFreq = applyCorpusFrequency(word, targetLang, frequency);
  frequency = corpusFreq.frequency;
  const frequency_count = corpusFreq.frequency_count;

  // Normalize forms and lemma
  const forms = normalizeForms(geminiFormsRaw);
  lemma = normalizeLemma(lemma, part_of_speech, targetLang);

  // Fetch image: use Gemini's IMAGE_TERM from enrichment, or raw word as last resort
  const imageSearchTerm = geminiImageTerm || word;
  const image_url = await fetchWordImage(imageSearchTerm);

  return { word, translation, definition, part_of_speech, frequency, frequency_count, example_sentence, sentence_translation, image_url, lemma, forms, image_term: geminiImageTerm || word };
}
