import { callGemini, enrichWord, fetchWordImage } from '../enrichWord.js';
import { applyCorpusFrequency } from '../lib/wordFrequency.js';
import { normalizeForms, normalizeLemma } from '../lib/normalizeWordFields.js';

export async function dedupeWordImages(words) {
  const usedUrls = new Set();

  for (const word of words) {
    if (word.image_url && usedUrls.has(word.image_url)) {
      const alt = await fetchWordImage(word.image_term || word.word, usedUrls);
      word.image_url = alt;
    }
    if (word.image_url) usedUrls.add(word.image_url);
  }

  return words;
}

export async function enrichAndInsertWords(client, postId, words, nativeLang, targetLang) {
  const enriched = await Promise.all(
    words.map(async (word, i) => {
      const wordStr = typeof word === 'string' ? word.trim() : word.word;
      if (typeof word === 'object' && word.translation) {
        return {
          word: wordStr,
          position: i,
          translation: word.translation,
          definition: word.definition ?? '',
          part_of_speech: word.part_of_speech ?? null,
          frequency: word.frequency ?? null,
          frequency_count: word.frequency_count ?? null,
          example_sentence: word.example_sentence ?? null,
          image_url: word.image_url ?? null,
          lemma: word.lemma ?? null,
          forms: word.forms ?? null,
          image_term: word.image_term ?? null,
        };
      }

      const result = await enrichWord(wordStr, '', nativeLang, targetLang);
      if (typeof word === 'object') {
        if (word.image_url !== undefined) result.image_url = word.image_url;
        if (word.definition !== undefined) result.definition = word.definition;
        if (word.example_sentence !== undefined) result.example_sentence = word.example_sentence;
      }
      return { word: wordStr, position: i, ...result };
    }),
  );

  await dedupeWordImages(enriched);

  for (const word of enriched) {
    await client.query(
      `INSERT INTO stream_post_words
         (post_id, word, translation, definition, part_of_speech, position,
          frequency, frequency_count, example_sentence, image_url, lemma, forms, image_term)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        postId,
        word.word,
        word.translation,
        word.definition,
        word.part_of_speech,
        word.position,
        word.frequency ?? null,
        word.frequency_count ?? null,
        word.example_sentence ?? null,
        word.image_url ?? null,
        word.lemma ?? null,
        word.forms ?? null,
        word.image_term ?? null,
      ],
    );
  }
}

export async function lookupWordForPost(word, nativeLang, targetLang) {
  const prompt = `Translate and define the ${targetLang || 'foreign'} word "${word}". The user's native language is ${nativeLang}.

Return a JSON object with exactly these keys:
{"translation":"...","definition":"...","part_of_speech":"...","example_sentence":"...","frequency":0,"lemma":"...","forms":"...","image_term":"..."}

- translation: standard ${nativeLang} translation of "${word}", 1-3 words max
- definition: what this word means in ${nativeLang}, 12 words max, no markdown
- part_of_speech: one of noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle
- example_sentence: a short sentence in ${targetLang} using "${word}", wrap the word with tildes like ~word~, 15 words max
- frequency: integer 1-10 how common this word is (1-2 rare, 3-4 uncommon, 5-6 moderate, 7-8 common everyday, 9-10 essential top-500)
- lemma: dictionary/base form (infinitive for verbs, singular for nouns). Same as word if already base form. Empty string for particles/prepositions.
- forms: comma-separated inflected forms of the lemma (e.g. "run, runs, ran, running"). Empty string if uninflected.
- image_term: an English search term for finding a photo of this word. Return an empty string if the word itself is already a clear, concrete, unambiguous noun that would return good image results (e.g. "cat", "bridge", "apple" -> empty string). Only provide a custom term when: the word has multiple meanings and might return wrong images, the word is abstract/unlikely to have good photos, or it's a verb/adjective needing visual representation. Keep it 1-4 words.

Respond with ONLY the JSON object, no other text.`;

  const raw = await callGemini(prompt, {
    thinkingConfig: { thinkingBudget: 0 },
    maxOutputTokens: 400,
    responseMimeType: 'application/json',
  });
  const parsed = JSON.parse(raw);
  const image_url = await fetchWordImage(parsed.image_term || word);

  const rawFrequency = typeof parsed.frequency === 'number' ? parsed.frequency : null;
  const { frequency, frequency_count } = applyCorpusFrequency(word, targetLang, rawFrequency);
  const forms = normalizeForms(parsed.forms);
  const lemma = normalizeLemma(parsed.lemma, parsed.part_of_speech, targetLang);

  return {
    translation: parsed.translation || '',
    definition: parsed.definition || '',
    part_of_speech: parsed.part_of_speech || null,
    example_sentence: parsed.example_sentence || null,
    image_url,
    frequency,
    frequency_count,
    lemma,
    forms,
    image_term: parsed.image_term || word,
  };
}

export async function lookupWordsForPost(words, nativeLang, targetLang) {
  const results = await Promise.all(
    words.map(async (word, i) => {
      const trimmed = word.trim();
      const enriched = await lookupWordForPost(trimmed, nativeLang, targetLang);
      return { id: `preview-${i}`, word: trimmed, position: i, ...enriched };
    }),
  );

  await dedupeWordImages(results);
  return results;
}
