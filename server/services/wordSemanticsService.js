import {
  callGemini,
  enrichWord,
  fetchNativeTranslations,
  fetchWiktSenses,
  fetchWiktTranslations,
} from '../enrichWord.js';

function parseJson(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    const error = new Error(`${context} returned invalid JSON`);
    error.cause = err;
    throw error;
  }
}

function makeContextError(message, context = {}) {
  const error = new Error(message);
  error.context = context;
  return error;
}

function ensureGeminiKeys(parsed, keys, context) {
  for (const key of keys) {
    if (!(key in parsed)) {
      throw makeContextError(`${context} omitted required field "${key}"`, { parsed });
    }
  }
}

async function chooseNativeTargetWord({ word, sentence, nativeLang, targetLang, candidates }) {
  if (candidates.length === 0) {
    throw makeContextError('No target-language translations were found for the selected native word', {
      word,
      nativeLang,
      targetLang,
    });
  }

  if (candidates.length === 1) {
    return {
      word,
      target_word: candidates[0].word,
      valid: true,
      translation: word,
      definition: '',
      part_of_speech: candidates[0].pos || null,
      sense_index: null,
      matched_gloss: candidates[0].sense || null,
      lemma: null,
      is_native: true,
    };
  }

  const candidateLines = candidates
    .map((candidate, index) => `${index}: [${candidate.pos || 'unknown'}] ${candidate.word} — ${candidate.sense || 'no gloss provided'}`)
    .join('\n');

  const raw = await callGemini(
    `The user clicked the ${nativeLang} word "${word}" in this sentence: "${sentence}".
The learner is studying ${targetLang}.

Choose the target-language translation that best matches the meaning of "${word}" in this sentence.

Candidates:
${candidateLines}

Return ONLY a JSON object with exactly these keys:
{"candidate_index":0,"lemma":"..."}

- candidate_index: the integer index of the best candidate
- lemma: the dictionary/base form of the chosen target-language word, or the chosen word unchanged if already base form`,
    {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 120,
      responseMimeType: 'application/json',
    },
  );

  const parsed = parseJson(raw, 'Native-word lookup');
  ensureGeminiKeys(parsed, ['candidate_index', 'lemma'], 'Native-word lookup');

  const candidateIndex = parsed.candidate_index;
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= candidates.length) {
    throw makeContextError('Native-word lookup returned an invalid candidate index', {
      candidateIndex,
      candidateCount: candidates.length,
    });
  }

  const chosen = candidates[candidateIndex];
  return {
    word,
    target_word: chosen.word,
    valid: true,
    translation: word,
    definition: '',
    part_of_speech: chosen.pos || null,
    sense_index: null,
    matched_gloss: chosen.sense || null,
    lemma: parsed.lemma || null,
    is_native: true,
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
    const nativeCandidates = await fetchNativeTranslations(word.toLowerCase(), nativeLang, targetLang);
    return chooseNativeTargetWord({
      word,
      sentence,
      nativeLang,
      targetLang,
      candidates: nativeCandidates,
    });
  }

  const wiktSenses = targetLang
    ? await fetchWiktSenses(word.toLowerCase(), targetLang, nativeLang)
    : [];

  const hasSenses = wiktSenses.length > 0;
  const senseBlock = hasSenses
    ? `\nHere are the dictionary senses for "${word}":\n${wiktSenses.map((s, i) => `${i}: [${s.pos}] ${s.gloss}`).join('\n')}\n`
    : '';
  const jsonKeys = hasSenses
    ? `{"valid":true/false,"translation":"...","definition":"...","part_of_speech":"...","sense_index":0,"lemma":"...","target_word":"..."}`
    : `{"valid":true/false,"translation":"...","definition":"...","part_of_speech":"...","lemma":"...","target_word":"..."}`;
  const senseInstruction = hasSenses
    ? `\n- sense_index: the integer index (0-${wiktSenses.length - 1}) of the sense that best matches this sentence.`
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
- lemma: the dictionary/base form of the target-language word.`,
    {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 220,
      responseMimeType: 'application/json',
    },
  );

  const parsed = parseJson(raw, 'Dictionary lookup');
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
    if (!Number.isInteger(idx) || idx < 0 || idx >= wiktSenses.length) {
      throw makeContextError('Dictionary lookup returned an invalid sense index', {
        senseIndex: idx,
        senseCount: wiktSenses.length,
      });
    }
    sense_index = idx;
    matched_gloss = wiktSenses[idx].gloss;
  }

  return {
    word,
    target_word: parsed.target_word || word,
    valid: parsed.valid ?? true,
    translation: parsed.translation || '',
    definition: parsed.definition || '',
    part_of_speech: parsed.part_of_speech || null,
    sense_index,
    matched_gloss,
    lemma: parsed.lemma || null,
    is_native: false,
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

    const picks = parseJson(raw, 'Batch translation disambiguation');
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
