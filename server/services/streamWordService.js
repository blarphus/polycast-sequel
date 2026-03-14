import { enrichWord } from '../enrichWord.js';
import { fetchWordImage } from '../lib/imageSearch.js';
import { lookupWordPreview } from './wordSemanticsService.js';

const WORD_ENRICH_CONCURRENCY = 4;

async function mapWithConcurrency(items, worker, concurrency = WORD_ENRICH_CONCURRENCY) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => consume());
  await Promise.all(workers);
  return results;
}

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
  const enriched = await mapWithConcurrency(
    words,
    async (word, i) => {
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
    },
  );

  await dedupeWordImages(enriched);

  if (enriched.length === 0) return;

  const values = [];
  const params = [];
  let paramIndex = 1;
  for (const word of enriched) {
    values.push(
      `($${paramIndex},$${paramIndex + 1},$${paramIndex + 2},$${paramIndex + 3},$${paramIndex + 4},$${paramIndex + 5},$${paramIndex + 6},$${paramIndex + 7},$${paramIndex + 8},$${paramIndex + 9},$${paramIndex + 10},$${paramIndex + 11},$${paramIndex + 12})`,
    );
    params.push(
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
    );
    paramIndex += 13;
  }

  await client.query(
    `INSERT INTO stream_post_words
       (post_id, word, translation, definition, part_of_speech, position,
        frequency, frequency_count, example_sentence, image_url, lemma, forms, image_term)
     VALUES ${values.join(', ')}`,
    params,
  );
}

export async function lookupWordsForPost(words, nativeLang, targetLang) {
  const results = await mapWithConcurrency(
    words,
    async (word, i) => {
      const trimmed = word.trim();
      const enriched = await lookupWordPreview(trimmed, nativeLang, targetLang);
      return { id: `preview-${i}`, word: trimmed, position: i, ...enriched };
    },
  );

  await dedupeWordImages(results);
  return results;
}
