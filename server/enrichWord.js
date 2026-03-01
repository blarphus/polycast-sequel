/**
 * enrichWord.js — shared word enrichment logic.
 * Used by both the dictionary route (POST /api/dictionary/enrich)
 * and the stream route (POST /api/stream/posts) at word-list creation time.
 */

import { applyEnglishFrequency } from './lib/englishFrequency.js';

export const API_HEADERS = { 'User-Agent': 'Polycast/1.0' };

export async function searchPixabay(query, perPage = 3) {
  const pixabayKey = process.env.PIXABAY_API_KEY;
  if (!pixabayKey) {
    console.error('PIXABAY_API_KEY is not set — skipping Pixabay search');
    return [];
  }
  const params = new URLSearchParams({
    key: pixabayKey,
    q: query,
    image_type: 'photo',
    per_page: String(perPage),
    safesearch: 'false',
  });
  const res = await fetch(`https://pixabay.com/api/?${params}`);
  if (!res.ok) {
    console.error('Pixabay search failed:', res.status);
    return [];
  }
  const data = await res.json();
  return (data.hits || []).map(h => h.webformatURL);
}

export async function fetchWordImage(searchTerm) {
  try {
    const urls = await searchPixabay(searchTerm);
    return urls[0] || null;
  } catch (err) {
    console.error('fetchWordImage error:', err);
    return null;
  }
}

function parseFrequency(str) {
  if (!str) return null;
  const n = parseInt(str, 10);
  if (isNaN(n)) {
    console.error('Gemini enrich returned non-numeric frequency:', str);
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
    const err = await response.text();
    console.error('Gemini API error:', err);
    throw new Error('Gemini request failed');
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error('Gemini API returned no text content:', JSON.stringify(data).slice(0, 500));
    throw new Error('Gemini returned no text content');
  }
  return text;
}

export const WIKT_EDITIONS = new Set([
  'cs','de','el','en','es','fr','id','it','ja','ko',
  'ku','ms','nl','pl','pt','ru','th','tr','vi','zh',
]);

export async function fetchWiktSenses(word, targetLang, nativeLang) {
  const edition = WIKT_EDITIONS.has(nativeLang) ? nativeLang : 'en';
  const url = `https://api.wiktapi.dev/v1/${edition}/word/${encodeURIComponent(word)}/definitions?lang=${targetLang}`;
  const response = await fetch(url, { headers: API_HEADERS });

  if (response.status === 404) return [];
  if (!response.ok) {
    console.error('WiktApi error:', response.status, await response.text().catch(() => ''));
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
    console.error('WiktApi translations error:', response.status, await response.text().catch(() => ''));
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
      console.error('fetchWiktSenses error in enrich:', err);
    }
  }

  let translation, definition, part_of_speech, frequency, example_sentence, geminiImageTerm, lemma, geminiFormsRaw;

  // Path C: senseIndex pre-identified by /lookup — use directly, skip sense-picking
  const hasSenseIndex = typeof senseIndex === 'number' && senseIndex >= 0;
  if (hasSenseIndex && wiktSenses.length > 0 && senseIndex < wiktSenses.length) {
    definition = wiktSenses[senseIndex].gloss;
    part_of_speech = wiktSenses[senseIndex].pos || null;

    const prompt = `You are a language-learning assistant. A user clicked the word "${word}" in: "${sentence}".
${targetLang ? `The sentence is in ${targetLang}.` : ''}
The user's native language is ${nativeLang}.
The word means: "${definition}" (${part_of_speech || 'unknown POS'}).

Respond in EXACTLY this format (six parts separated by " // "):
TRANSLATION // FREQUENCY // EXAMPLE // IMAGE_TERM // LEMMA // FORMS

- TRANSLATION: The word translated into ${nativeLang}. Just the word(s), nothing else.
- FREQUENCY: An integer 1-10 rating how common this word is for a language learner:
  1-2: Rare/specialized words most learners won't encounter
  3-4: Uncommon words that appear in specific contexts
  5-6: Moderately common words useful for intermediate learners
  7-8: Common everyday words important for conversation
  9-10: Essential high-frequency words (top 500 most used)
- EXAMPLE: A short example sentence in ${targetLang || 'the target language'} using the word. Wrap the word with tildes like ~word~. Keep it under 15 words.
- IMAGE_TERM: A 1-4 word English phrase describing a concrete, photographable subject that captures THIS SPECIFIC meaning of the word. The term must work as a stock-photo search query.
  Concrete nouns → the object itself: "cat" → "cat", "bridge" → "bridge"
  Abstract adjectives → a vivid scene embodying the quality: "stupendous" → "mountain landscape", "fragile" → "cracked glass"
  Verbs → a snapshot of the action in context: "screwing" (fastening) → "screwdriver", "screwing" (slang) → "couple in bed"
  Abstract nouns → a tangible symbol: "freedom" → "open bird cage", "justice" → "courthouse"
  Do NOT repeat the word itself unless it is already a concrete, photographable noun.
- LEMMA: The dictionary/base form of this word in the target language.
  For verbs: the infinitive (e.g. "to work" in English, "trabajar" in Spanish).
  For nouns: the singular (e.g. "cat" not "cats").
  For adjectives/adverbs: the positive form (e.g. "big" not "bigger").
  If the word is already its base form, return it unchanged. Leave empty for
  particles, prepositions, conjunctions, and other uninflected words.
- FORMS: Comma-separated list of all inflected forms of the LEMMA.
  Verbs: all conjugations (e.g. "run, runs, ran, running").
  Nouns: singular and plural (e.g. "cat, cats").
  Adjectives/adverbs: all degrees (e.g. "big, bigger, biggest").
  Leave empty for particles, prepositions, conjunctions, and other uninflected words.`;

    const raw = await callGemini(prompt);
    const parts = raw.split('//').map((s) => s.trim());
    if (parts.length < 6) {
      console.error(`Gemini enrich (Path C) returned ${parts.length} parts instead of 6:`, raw.slice(0, 300));
    }

    translation = parts[0] || '';
    frequency = parseFrequency(parts[1]);
    example_sentence = parts[2] || null;
    geminiImageTerm = parts[3]?.trim() || null;
    lemma = parts[4]?.trim() || null;
    geminiFormsRaw = parts[5]?.trim() || null;
  } else if (hasSenseIndex && (wiktSenses.length === 0 || senseIndex >= wiktSenses.length)) {
    // senseIndex provided but invalid (senses changed between lookup and enrich) — fall through
    console.error('enrich: senseIndex', senseIndex, 'out of range for', wiktSenses.length, 'senses — falling through to Path A/B');
  }

  // Path A/B: only run if Path C didn't set translation (i.e. it was skipped)
  if (translation === undefined) {
    if (wiktSenses.length > 0) {
      // Path A: Wiktionary senses available — ask Gemini to pick the best one
      const senseList = wiktSenses.map((s, i) => `${i}: [${s.pos}] ${s.gloss}`).join('\n');

      const prompt = `You are a language-learning assistant. A user clicked the word "${word}" in: "${sentence}".
${targetLang ? `The sentence is in ${targetLang}.` : ''}
The user's native language is ${nativeLang}.

Here are the dictionary senses for "${word}":
${senseList}

Respond in EXACTLY this format (eight parts separated by " // "):
TRANSLATION // SENSE_INDEX // FREQUENCY // EXAMPLE // IMAGE_TERM // FALLBACK_DEFINITION // LEMMA // FORMS

- TRANSLATION: The word translated into ${nativeLang}. Just the word(s), nothing else.
- SENSE_INDEX: The integer index (0-${wiktSenses.length - 1}) of the sense that best matches how "${word}" is used in the sentence.
- FREQUENCY: An integer 1-10 rating how common this word is for a language learner:
  1-2: Rare/specialized words most learners won't encounter
  3-4: Uncommon words that appear in specific contexts
  5-6: Moderately common words useful for intermediate learners
  7-8: Common everyday words important for conversation
  9-10: Essential high-frequency words (top 500 most used)
- EXAMPLE: A short example sentence in ${targetLang || 'the target language'} using the word. Wrap the word with tildes like ~word~. Keep it under 15 words.
- IMAGE_TERM: A 1-4 word English phrase describing a concrete, photographable subject that captures THIS SPECIFIC meaning of the word. The term must work as a stock-photo search query.
  Concrete nouns → the object itself: "cat" → "cat", "bridge" → "bridge"
  Abstract adjectives → a vivid scene embodying the quality: "stupendous" → "mountain landscape", "fragile" → "cracked glass"
  Verbs → a snapshot of the action in context: "screwing" (fastening) → "screwdriver", "screwing" (slang) → "couple in bed"
  Abstract nouns → a tangible symbol: "freedom" → "open bird cage", "justice" → "courthouse"
  Do NOT repeat the word itself unless it is already a concrete, photographable noun.
- FALLBACK_DEFINITION: A brief explanation of how this word is used in the given sentence, in ${nativeLang}. 15 words max. No markdown. Only used if SENSE_INDEX is invalid.
- LEMMA: The dictionary/base form of this word in the target language.
  For verbs: the infinitive (e.g. "to work" in English, "trabajar" in Spanish).
  For nouns: the singular (e.g. "cat" not "cats").
  For adjectives/adverbs: the positive form (e.g. "big" not "bigger").
  If the word is already its base form, return it unchanged. Leave empty for
  particles, prepositions, conjunctions, and other uninflected words.
- FORMS: Comma-separated list of all inflected forms of the LEMMA.
  Verbs: all conjugations (e.g. "run, runs, ran, running").
  Nouns: singular and plural (e.g. "cat, cats").
  Adjectives/adverbs: all degrees (e.g. "big, bigger, biggest").
  Leave empty for particles, prepositions, conjunctions, and other uninflected words.`;

      const raw = await callGemini(prompt);

      const parts = raw.split('//').map((s) => s.trim());
      if (parts.length < 8) {
        console.error(`Gemini enrich (wikt) returned ${parts.length} parts instead of 8:`, raw.slice(0, 300));
      }

      translation = parts[0] || '';

      // Resolve definition + POS from sense index
      const resolvedSenseIndex = parseInt(parts[1], 10);
      if (!isNaN(resolvedSenseIndex) && resolvedSenseIndex >= 0 && resolvedSenseIndex < wiktSenses.length) {
        definition = wiktSenses[resolvedSenseIndex].gloss;
        part_of_speech = wiktSenses[resolvedSenseIndex].pos || null;
      } else {
        console.error('Gemini returned invalid SENSE_INDEX:', parts[1], `(valid: 0-${wiktSenses.length - 1})`);
        definition = parts[5] || '';
        part_of_speech = null;
      }

      frequency = parseFrequency(parts[2]);
      example_sentence = parts[3] || null;
      geminiImageTerm = parts[4]?.trim() || null;
      lemma = parts[6]?.trim() || null;
      geminiFormsRaw = parts[7]?.trim() || null;
    } else {
      // Path B: No Wiktionary senses — full Gemini generation
      const prompt = `You are a language-learning assistant. A user clicked the word "${word}" in: "${sentence}".
${targetLang ? `The sentence is in ${targetLang}.` : ''}
The user's native language is ${nativeLang}.

Respond in EXACTLY this format (eight parts separated by " // "):
TRANSLATION // DEFINITION // PART_OF_SPEECH // FREQUENCY // EXAMPLE // IMAGE_TERM // LEMMA // FORMS

- TRANSLATION: The word translated into ${nativeLang}. Just the word(s), nothing else.
- DEFINITION: A brief explanation of how this word is used in the given sentence, in ${nativeLang}. 15 words max. No markdown.
- PART_OF_SPEECH: One of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle. Lowercase English.
- FREQUENCY: An integer 1-10 rating how common this word is for a language learner:
  1-2: Rare/specialized words most learners won't encounter
  3-4: Uncommon words that appear in specific contexts
  5-6: Moderately common words useful for intermediate learners
  7-8: Common everyday words important for conversation
  9-10: Essential high-frequency words (top 500 most used)
- EXAMPLE: A short example sentence in ${targetLang || 'the target language'} using the word. Wrap the word with tildes like ~word~. Keep it under 15 words.
- IMAGE_TERM: A 1-4 word English phrase describing a concrete, photographable subject that captures THIS SPECIFIC meaning of the word. The term must work as a stock-photo search query.
  Concrete nouns → the object itself: "cat" → "cat", "bridge" → "bridge"
  Abstract adjectives → a vivid scene embodying the quality: "stupendous" → "mountain landscape", "fragile" → "cracked glass"
  Verbs → a snapshot of the action in context: "screwing" (fastening) → "screwdriver", "screwing" (slang) → "couple in bed"
  Abstract nouns → a tangible symbol: "freedom" → "open bird cage", "justice" → "courthouse"
  Do NOT repeat the word itself unless it is already a concrete, photographable noun.
- LEMMA: The dictionary/base form of this word in the target language.
  For verbs: the infinitive (e.g. "to work" in English, "trabajar" in Spanish).
  For nouns: the singular (e.g. "cat" not "cats").
  For adjectives/adverbs: the positive form (e.g. "big" not "bigger").
  If the word is already its base form, return it unchanged. Leave empty for
  particles, prepositions, conjunctions, and other uninflected words.
- FORMS: Comma-separated list of all inflected forms of the LEMMA.
  Verbs: all conjugations (e.g. "run, runs, ran, running").
  Nouns: singular and plural (e.g. "cat, cats").
  Adjectives/adverbs: all degrees (e.g. "big, bigger, biggest").
  Leave empty for particles, prepositions, conjunctions, and other uninflected words.`;

      const raw = await callGemini(prompt);

      const parts = raw.split('//').map((s) => s.trim());
      if (parts.length < 8) {
        console.error(`Gemini enrich returned ${parts.length} parts instead of 8:`, raw.slice(0, 300));
      }
      translation = parts[0] || '';
      definition = parts[1] || '';
      part_of_speech = parts[2] || null;
      frequency = parseFrequency(parts[3]);
      example_sentence = parts[4] || null;
      geminiImageTerm = parts[5]?.trim() || null;
      lemma = parts[6]?.trim() || null;
      geminiFormsRaw = parts[7]?.trim() || null;
    }
  } // end if (translation === undefined) — Path A/B

  // For English target words, override Gemini frequency with SUBTLEX-US corpus data
  const englishFreq = applyEnglishFrequency(word, targetLang, frequency);
  frequency = englishFreq.frequency;
  const frequency_count = englishFreq.frequency_count;

  // Parse forms from Gemini's comma-separated FORMS field
  let forms = null;
  if (geminiFormsRaw) {
    const formsList = geminiFormsRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (formsList.length > 1) {
      forms = JSON.stringify(formsList);
    }
  }

  // Normalize English verb lemmas to "to [verb]"
  if (lemma && part_of_speech === 'verb' && (targetLang === 'en' || targetLang?.startsWith('en-'))) {
    if (!lemma.startsWith('to ')) lemma = 'to ' + lemma;
  }

  if (!lemma) lemma = null;

  // Fetch image: use Gemini's IMAGE_TERM from enrichment, or raw word as last resort
  const imageSearchTerm = geminiImageTerm || word;
  const image_url = await fetchWordImage(imageSearchTerm);

  return { word, translation, definition, part_of_speech, frequency, frequency_count, example_sentence, image_url, lemma, forms, image_term: geminiImageTerm || word };
}
