import { callGemini, parseGeminiJson, ensureGeminiKeys } from '../lib/gemini.js';
import {
  enrichWord,
  fetchWiktSenses,
  fetchWiktTranslations,
  persistGeminiFallbackSense,
} from '../enrichWord.js';

function makeContextError(message, context = {}) {
  const error = new Error(message);
  error.context = context;
  return error;
}

async function translateViaTildeTrick(word, sentence, nativeLang, targetLang) {
  const markedSentence = sentence.replace(word, `~${word}~`);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${nativeLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(markedSentence)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Translate request failed with status ${res.status}`);
  }
  const data = await res.json();

  // Extract translated text from response segments
  const translated = (data[0] || []).map(seg => seg[0] || '').join('');

  // Look for tilde-wrapped word in the translated output
  const tildeMatch = translated.match(/~([^~]+)~/);
  if (tildeMatch) {
    return tildeMatch[1].trim();
  }

  // Tildes stripped — fall back to translating the bare word
  const fallbackUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${nativeLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(word)}`;
  const fallbackRes = await fetch(fallbackUrl);
  if (!fallbackRes.ok) {
    throw new Error(`Google Translate fallback request failed with status ${fallbackRes.status}`);
  }
  const fallbackData = await fallbackRes.json();
  return (fallbackData[0]?.[0]?.[0] || '').trim();
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
    const targetWord = await translateViaTildeTrick(word, sentence, nativeLang, targetLang);
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
- lemma: the dictionary/base form of the target-language word.`,
    {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 220,
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
