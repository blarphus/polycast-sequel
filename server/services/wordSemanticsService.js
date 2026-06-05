import { callGemini, parseGeminiJson, ensureGeminiKeys } from '../lib/gemini.js';
import {
  enrichWord,
  fetchWiktSenses,
  fetchWiktTranslations,
  persistGeminiFallbackSense,
} from '../enrichWord.js';
// FLAGGED FOR DELETION — local ONNX sense-picker replaced by Gemini index-pick (Flash Lite).
// import { pickSense, isModelReady } from '../lib/sensePicker.js';

function makeContextError(message, context = {}) {
  const error = new Error(message);
  error.context = context;
  return error;
}

// Parse a JSON object out of a model reply, tolerating stray markdown fences or surrounding
// prose by extracting the first {...} block.
function parseJsonObject(raw, errorLabel, context) {
  const match = raw.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(match ? match[0] : raw);
  } catch {
    throw makeContextError(errorLabel, { ...context, raw });
  }
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

// pickBestSense — Gemini reads the sentence and the candidate senses and returns EITHER the
// index of the sense that states the meaning, OR — when the best-matching sense doesn't define
// the word but only points to a base form (e.g. "plural of mão", "female equivalent of
// enfermeiro", "alternative form of caracterizar", or a bare grammatical label) — the base
// word to look up instead. Returns {index} | {base} | {index:-1}. Flash Lite: trivial
// classification, so the cheapest model is ample.
async function pickBestSense(word, sentence, targetLang, senses) {
  const senseList = senses.map((s, i) => `${i}: [${s.pos}] ${s.gloss}`).join('\n');
  const raw = await callGemini(
    `The word "${word}" appears in this sentence: "${sentence}" (${targetLang}).
Candidate dictionary senses:
${senseList}

Pick the sense that best matches how "${word}" is used here, then look at THAT sense's wording and reply with ONLY a JSON object:
- If the wording does not state a meaning but merely points to another word — it says the word is e.g. a "plural of X", "feminine of X", "past participle of X", "alternative form of X", "female/male equivalent of X", or is only a grammatical label like "third-person singular present indicative" — reply {"base": "<that other word X>"} (even if it also gives a short meaning in parentheses).
- If the wording itself states the meaning (e.g. "to rip", "a fortune teller"), reply {"index": <integer index>}, even if "${word}" is grammatically derived from another word.
- If none of the senses are relevant, reply {"index": -1}.`,
    { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 40, responseMimeType: 'application/json' },
    'gemini-flash-lite-latest',
  );

  const parsed = parseJsonObject(raw, 'Gemini sense pick returned invalid JSON', { word, targetLang });

  if (typeof parsed.base === 'string' && parsed.base.trim()) {
    return { base: parsed.base.trim() };
  }
  if (Number.isInteger(parsed.index)) {
    if (parsed.index < -1 || parsed.index >= senses.length) {
      throw makeContextError('Gemini sense pick returned an out-of-range index', {
        word, targetLang, raw, senseCount: senses.length,
      });
    }
    return { index: parsed.index };
  }
  throw makeContextError('Gemini sense pick returned neither a valid index nor a base word', {
    word, targetLang, raw,
  });
}

// pickSenseIndex — plain "which sense fits" pick over a base word's real senses. No {base}
// option, so it can't self-loop, and it's lenient about the base word not appearing literally
// in the sentence (the inflected form does). Returns the index, or -1 if none fit.
async function pickSenseIndex(word, sentence, targetLang, senses) {
  const senseList = senses.map((s, i) => `${i}: [${s.pos}] ${s.gloss}`).join('\n');
  const raw = await callGemini(
    `The word "${word}" (or an inflected form of it) is used in: "${sentence}" (${targetLang}).
Senses:
${senseList}
Reply with ONLY a JSON object {"index": <integer>} for the sense that best fits this usage, or {"index": -1} if none fit.`,
    { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 20, responseMimeType: 'application/json' },
    'gemini-flash-lite-latest',
  );
  const parsed = parseJsonObject(raw, 'Gemini index pick returned invalid JSON', { word, targetLang });
  if (!Number.isInteger(parsed.index) || parsed.index < -1 || parsed.index >= senses.length) {
    throw makeContextError('Gemini index pick returned an invalid index', {
      word, targetLang, raw, senseCount: senses.length,
    });
  }
  return parsed.index;
}

// resolvePick — turn a top-level pick into a concrete { definition, part_of_speech, sense_index,
// lemma }. {index} uses that sense; {base} means the sense only points to a base word, so we
// look IT up and pick the matching sense from its real senses (fetchWiktSenses already expands
// one form-of hop, so a single base hop covers the common chains). {index:-1}, or a base word
// absent from the DB, returns null so the caller escalates to the full Gemini path.
async function resolvePick(pick, senses, sentence, targetLang, nativeLang) {
  if (pick.base) {
    const { senses: baseSenses } = await fetchWiktSenses(pick.base.toLowerCase(), targetLang, nativeLang);
    if (baseSenses.length === 0) return null;
    const idx = baseSenses.length === 1 ? 0 : await pickSenseIndex(pick.base, sentence, targetLang, baseSenses);
    if (idx === -1) return null;
    const sense = baseSenses[idx];
    return {
      definition: sense.gloss,
      part_of_speech: sense.pos || null,
      sense_index: idx,
      lemma: pick.base,
    };
  }

  if (pick.index === -1) return null;
  const sense = senses[pick.index];
  if (!sense) return null;
  return {
    definition: sense.gloss,
    part_of_speech: sense.pos || null,
    sense_index: pick.index,
    lemma: sense.lemma ?? null,
  };
}

export async function resolveDictionaryLookupFast({ word, sentence, nativeLang, targetLang }) {
  const { senses: wiktSenses } = targetLang
    ? await fetchWiktSenses(word.toLowerCase(), targetLang, nativeLang)
    : { senses: [] };
  if (wiktSenses.length === 0) return null; // caller falls back to full Gemini

  // One path for every word: Gemini always picks. Run the pick + translation in parallel.
  const [pick, translation] = await Promise.all([
    pickBestSense(word, sentence, targetLang, wiktSenses),
    translateWordInSentence(word, sentence, targetLang, nativeLang),
  ]);

  const resolved = await resolvePick(pick, wiktSenses, sentence, targetLang, nativeLang);
  if (!resolved) return null; // no fitting sense / unresolvable base — escalate to full Gemini

  return {
    word,
    target_word: word,
    valid: true,
    translation,
    definition: resolved.definition,
    part_of_speech: resolved.part_of_speech,
    sense_index: resolved.sense_index ?? null,
    matched_gloss: resolved.definition,
    lemma: resolved.lemma,
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
