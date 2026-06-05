import { callGemini, parseGeminiJson, ensureGeminiKeys } from '../lib/gemini.js';
import {
  enrichWord,
  fetchWiktSenses,
  fetchWiktTranslations,
  persistGeminiFallbackSense,
  isFormOf,
  extractFormOfLemma,
} from '../enrichWord.js';
// FLAGGED FOR DELETION — local ONNX sense-picker replaced by Gemini index-pick (Flash Lite).
// import { pickSense, isModelReady } from '../lib/sensePicker.js';

function makeContextError(message, context = {}) {
  const error = new Error(message);
  error.context = context;
  return error;
}

async function translateWordInSentence(word, sentence, sourceLang, targetLang) {
  const markedSentence = sentence.replace(word, `~${word}~`);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(markedSentence)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Translate request failed with status ${res.status}`);
  }
  const data = await res.json();
  const translated = (data[0] || []).map((seg) => seg[0] || '').join('');
  const tildeMatch = translated.match(/~([^~]+)~/);
  if (tildeMatch) {
    return tildeMatch[1].trim();
  }

  const fallbackUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(word)}`;
  const fallbackRes = await fetch(fallbackUrl);
  if (!fallbackRes.ok) {
    throw new Error(`Google Translate fallback request failed with status ${fallbackRes.status}`);
  }
  const fallbackData = await fallbackRes.json();
  return (fallbackData[0]?.[0]?.[0] || '').trim();
}

// pickBestSense — Gemini reads the sentence context and picks the Wiktionary sense
// index whose gloss best matches the usage. Returns -1 when none of the senses fit,
// signalling the caller to escalate to the full Gemini path (which writes its own
// definition). Uses Flash Lite: picking one integer is trivial classification, so the
// cheapest model is ample (see plan — index-pick is ~1/10th the cost of generating a
// definition).
async function pickBestSense(word, sentence, targetLang, senses) {
  const senseList = senses.map((s, i) => `${i}: [${s.pos}] ${s.gloss}`).join('\n');
  const raw = await callGemini(
    `The word "${word}" appears in this sentence: "${sentence}" (${targetLang}).
Pick the sense index whose definition best matches how the word is used here.
If NONE of the senses match the usage, return -1.
Return ONLY the integer.
${senseList}`,
    { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 10, responseMimeType: 'text/plain' },
    'gemini-flash-lite-latest',
  );
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw makeContextError('Gemini sense pick returned a non-integer response', {
      word,
      targetLang,
      raw: trimmed,
      senseCount: senses.length,
    });
  }

  const idx = Number.parseInt(trimmed, 10);
  // -1 is a valid "no sense fits" signal; anything below that or past the list is invalid.
  if (idx < -1 || idx >= senses.length) {
    throw makeContextError('Gemini sense pick returned an invalid sense index', {
      word,
      targetLang,
      raw: trimmed,
      senseIndex: idx,
      senseCount: senses.length,
    });
  }

  return idx;
}

// resolveFormOfChain — when a picked sense is a bare inflection / alternative-form note
// ("third-person form of rasgar", "alternative form of caracterizar") rather than a real
// definition, follow the reference to the base word and pick a real definition from ITS
// senses. Recurses to handle multi-hop chains (conjugation → alt-spelling → standard word),
// since the DB-level expansion only resolves one hop. Returns null when the chain can't be
// resolved from the DB (base word absent, or Gemini finds no fitting sense), so the caller
// escalates to the full Gemini path, which writes its own definition.
async function resolveFormOfChain(gloss, sentence, targetLang, nativeLang, depth = 0) {
  if (depth >= 3) return null; // guard against pathological/cyclic chains
  const lemma = extractFormOfLemma(gloss);
  if (!lemma) return null;

  const { senses } = await fetchWiktSenses(lemma.toLowerCase(), targetLang, nativeLang);
  if (senses.length === 0) return null;

  const idx = senses.length === 1 ? 0 : await pickBestSense(lemma, sentence, targetLang, senses);
  if (idx === -1) return null;

  const picked = senses[idx];
  if (isFormOf(picked.gloss)) {
    return resolveFormOfChain(picked.gloss, sentence, targetLang, nativeLang, depth + 1);
  }
  return { definition: picked.gloss, part_of_speech: picked.pos || null, lemma };
}

export async function resolveDictionaryLookupFast({ word, sentence, nativeLang, targetLang }) {
  const { senses: wiktSenses, resolvedLemma } = targetLang
    ? await fetchWiktSenses(word.toLowerCase(), targetLang, nativeLang)
    : { senses: [], resolvedLemma: null };
  if (wiktSenses.length === 0) return null; // caller falls back to full Gemini

  // Run sense-picking + translation in parallel
  const [senseIndex, translation] = await Promise.all([
    wiktSenses.length === 1 ? Promise.resolve(0) : pickBestSense(word, sentence, targetLang, wiktSenses),
    translateWordInSentence(word, sentence, targetLang, nativeLang),
  ]);

  // -1 = none of the Wiktionary senses fit the usage. Return null so the route
  // escalates to the full Gemini path, which generates + caches a proper definition.
  if (senseIndex === -1) return null;

  const sense = wiktSenses[senseIndex];
  let definition = sense.gloss;
  let partOfSpeech = sense.pos || null;
  let lemma = resolvedLemma;

  // If the picked sense is a bare form-of note rather than a real definition, follow the
  // reference chain to the base word and show ITS definition instead.
  if (isFormOf(sense.gloss)) {
    const resolved = await resolveFormOfChain(sense.gloss, sentence, targetLang, nativeLang);
    if (!resolved) return null; // unresolvable from DB — escalate to full Gemini path
    definition = resolved.definition;
    partOfSpeech = resolved.part_of_speech;
    lemma = resolved.lemma;
  }

  return {
    word,
    target_word: word,
    valid: true,
    translation,
    definition,
    part_of_speech: partOfSpeech,
    sense_index: senseIndex,
    matched_gloss: definition,
    lemma,
    is_native: false,
    definition_source: 'wiktionary',
    example: null,
    example_translation: null,
    sentence_translation: null,
  };
}

export async function resolveDictionaryLookup({
  word,
  sentence,
  nativeLang,
  targetLang,
  isNative = false,
}) {
  if (isNative) {
    if (!targetLang) {
      throw new Error('targetLang is required for native-word lookup');
    }
    const targetWord = await translateWordInSentence(word, sentence, nativeLang, targetLang);
    if (!targetWord) {
      throw makeContextError('Google Translate returned no translation for the selected native word', {
        word,
        nativeLang,
        targetLang,
      });
    }
    return {
      word,
      target_word: targetWord,
      valid: true,
      translation: word,
      definition: '',
      part_of_speech: null,
      sense_index: null,
      matched_gloss: null,
      lemma: null,
      is_native: true,
    };
  }

  const { senses: wiktSenses } = targetLang
    ? await fetchWiktSenses(word.toLowerCase(), targetLang, nativeLang)
    : { senses: [] };

  const hasSenses = wiktSenses.length > 0;
  const senseBlock = hasSenses
    ? `\nHere are the dictionary senses for "${word}":\n${wiktSenses.map((s, i) => `${i}: [${s.pos}] ${s.gloss}`).join('\n')}\n`
    : '';
  const jsonKeys = hasSenses
    ? `{"valid":true/false,"translation":"...","definition":"...","part_of_speech":"...","sense_index":0,"lemma":"...","target_word":"...","sentence_translation":"...","example":"...","example_translation":"..."}`
    : `{"valid":true/false,"translation":"...","definition":"...","part_of_speech":"...","lemma":"...","target_word":"...","sentence_translation":"...","example":"...","example_translation":"..."}`;
  const senseInstruction = hasSenses
    ? `\n- sense_index: the integer index (0-${wiktSenses.length - 1}) of the sense that best matches this sentence. If NONE of the senses match how the word is used, return -1 and provide your own definition.`
    : '';

  const raw = await callGemini(
    `The word "${word}" appears in this sentence: "${sentence}".
The learner is studying ${targetLang || 'the target language'} and speaks ${nativeLang}.

If "${word}" is not a real word in ${targetLang || 'the target language'}, set valid to false and leave the other fields empty.
${senseBlock}
Return ONLY a JSON object with exactly these keys:
${jsonKeys}

- target_word: the target-language word to save. If "${word}" is already in the target language, return it unchanged.
- valid: true if this is a real word, false otherwise.
- translation: the standard ${nativeLang} translation of the target-language word in this sense, 1-3 words max.
- definition: define the word itself in ${nativeLang}, 12 words max.
- part_of_speech: one of noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle.
${senseInstruction}
- lemma: the dictionary/base form of the target-language word.
- sentence_translation: translate the full sentence "${sentence}" into ${nativeLang}. Surround the word(s) that correspond to "${word}" with tildes like ~translated word~.
- example: a short, simple beginner-level example sentence in ${targetLang || 'the target language'} using the word. Surround the word with tildes like ~word~. Keep it under 8 words.
- example_translation: the ${nativeLang} translation of the example sentence. Surround the word(s) that correspond to "${word}" with tildes like ~translated word~.`,
    {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 350,
      responseMimeType: 'application/json',
    },
  );

  const parsed = parseGeminiJson(raw, 'Dictionary lookup');
  ensureGeminiKeys(
    parsed,
    hasSenses
      ? ['target_word', 'valid', 'translation', 'definition', 'part_of_speech', 'sense_index', 'lemma']
      : ['target_word', 'valid', 'translation', 'definition', 'part_of_speech', 'lemma'],
    'Dictionary lookup',
  );

  let sense_index = null;
  let matched_gloss = null;
  if (hasSenses) {
    const idx = parsed.sense_index;
    if (Number.isInteger(idx) && idx >= 0 && idx < wiktSenses.length) {
      sense_index = idx;
      matched_gloss = wiktSenses[idx].gloss;
    }
    // idx === -1 or invalid: Gemini says no sense matches — use its own definition
    if (sense_index === null && parsed.definition && parsed.part_of_speech && targetLang) {
      persistGeminiFallbackSense({ word, lang: targetLang, pos: parsed.part_of_speech, definition: parsed.definition });
    }
  }

  // No wiktionary senses at all — persist Gemini's definition
  if (!hasSenses && parsed.definition && parsed.part_of_speech && targetLang) {
    persistGeminiFallbackSense({ word, lang: targetLang, pos: parsed.part_of_speech, definition: parsed.definition });
  }

  return {
    word,
    target_word: parsed.target_word || word,
    valid: parsed.valid ?? true,
    translation: parsed.translation || '',
    definition: matched_gloss || parsed.definition || '',
    part_of_speech: parsed.part_of_speech || null,
    sense_index,
    matched_gloss,
    lemma: parsed.lemma || null,
    is_native: false,
    definition_source: matched_gloss ? 'wiktionary' : 'gemini',
    example: parsed.example || null,
    example_translation: parsed.example_translation || null,
    sentence_translation: parsed.sentence_translation || null,
  };
}

export async function lookupWordPreview(word, nativeLang, targetLang) {
  const result = await enrichWord(word, '', nativeLang, targetLang);
  return {
    translation: result.translation,
    definition: result.definition,
    part_of_speech: result.part_of_speech,
    example_sentence: result.example_sentence,
    image_url: result.image_url,
    frequency: result.frequency,
    frequency_count: result.frequency_count,
    lemma: result.lemma,
    forms: result.forms,
    image_term: result.image_term,
  };
}

export async function lookupWordsForPreview(words, nativeLang, targetLang) {
  const previews = [];
  for (let index = 0; index < words.length; index += 1) {
    const rawWord = words[index];
    const trimmed = rawWord.trim();
    if (!trimmed) {
      throw makeContextError('Word preview received an empty word entry', { index });
    }
    const enriched = await lookupWordPreview(trimmed, nativeLang, targetLang);
    previews.push({ id: `preview-${index}`, word: trimmed, position: index, ...enriched });
  }
  return previews;
}

export async function batchTranslateWordList({ words, nativeLang, allWords }) {
  const translationsPerWord = await Promise.all(
    words.map((word) => fetchWiktTranslations(word.word, nativeLang)),
  );

  const unitWordList = Array.isArray(allWords) && allWords.length > 0
    ? allWords
    : words.map((word) => word.word);

  const results = new Array(words.length).fill(null);
  const ambiguous = [];

  for (let index = 0; index < words.length; index += 1) {
    const translations = translationsPerWord[index];
    if (translations.length === 0) {
      throw makeContextError('No Wiktionary translations were found for a word-list entry', {
        word: words[index].word,
        nativeLang,
      });
    }

    const withWords = translations.filter((translation) => translation.words.length > 0);
    if (withWords.length === 1) {
      results[index] = {
        translation: withWords[0].words[0],
        definition: withWords[0].sense,
      };
      continue;
    }

    ambiguous.push({
      index,
      word: words[index].word,
      definition: words[index].definition,
      senses: translations.map((translation) => ({
        label: `[${translation.pos}] ${translation.sense}${translation.words.length > 0 ? ` → ${translation.words.join(', ')}` : ''}`,
        translation: translation.words[0] || null,
        definition: translation.sense,
      })),
    });
  }

  if (ambiguous.length > 0) {
    const wordEntries = ambiguous
      .map((entry, entryIndex) => {
        const senseList = entry.senses.map((sense, senseIndex) => `  ${senseIndex}: ${sense.label}`).join('\n');
        return `WORD ${entryIndex}: "${entry.word}" (English definition: "${entry.definition}")\n${senseList}`;
      })
      .join('\n\n');

    const raw = await callGemini(
      `You are a vocabulary-list translation assistant.

A teacher is translating an English vocabulary unit into ${nativeLang}.
The full unit contains these words: ${unitWordList.join(', ')}.

For each word below, choose the sense index that best matches the intended meaning in this unit.

${wordEntries}

Return ONLY a JSON array in order:
[{"sense_index":0}, ...]`,
      {
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 300,
        responseMimeType: 'application/json',
      },
    );

    const picks = parseGeminiJson(raw, 'Batch translation disambiguation');
    if (!Array.isArray(picks) || picks.length !== ambiguous.length) {
      throw makeContextError('Batch translation disambiguation returned an unexpected payload length', {
        expected: ambiguous.length,
        received: Array.isArray(picks) ? picks.length : null,
      });
    }

    for (let index = 0; index < ambiguous.length; index += 1) {
      const entry = ambiguous[index];
      const senseIndex = picks[index]?.sense_index;
      if (!Number.isInteger(senseIndex) || senseIndex < 0 || senseIndex >= entry.senses.length) {
        throw makeContextError('Batch translation disambiguation returned an invalid sense index', {
          word: entry.word,
          senseIndex,
          senseCount: entry.senses.length,
        });
      }

      const sense = entry.senses[senseIndex];
      if (!sense.translation) {
        throw makeContextError('Batch translation disambiguation chose a sense without a native-language translation', {
          word: entry.word,
          nativeLang,
          senseIndex,
        });
      }

      results[entry.index] = {
        translation: sense.translation,
        definition: sense.definition,
      };
    }
  }

  return results;
}
