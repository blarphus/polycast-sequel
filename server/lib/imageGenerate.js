import { generateOpenAiImage } from './openaiImage.js';
import logger from '../logger.js';

/** Wrap the first occurrence of the target word in the sentence with tildes. */
function markWord(sentence, word) {
  if (!sentence || !word) return sentence || '';
  const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
  return re.test(sentence) ? sentence.replace(re, '~$1~') : sentence;
}

/**
 * Generate a flashcard illustration for a word when no stock photo fit it
 * (typically abstract concepts where keyword image search only returns unrelated
 * photos). Returns { buffer, contentType } or null on failure (logged, not
 * swallowed).
 *
 * GPT Image 2 follows instructions well, so we give it the full context — the
 * word, its definition, the source sentence with the target word tilde-marked,
 * and the concrete-representation guidance — and let the model do the abstraction
 * itself (e.g. render "fecund" as a mother with many children). `imageTerm` is
 * passed only as an optional concrete-subject hint.
 */
export async function generateWordImage(word, definition, { sentence = '', imageTerm = '' } = {}) {
  const marked = markWord(sentence, word);
  const prompt =
    `Create a clean, simple illustration for a language-learning flashcard that represents the word "${word}"`
    + (definition ? ` (meaning: ${definition})` : '') + `.`
    + (marked ? ` It is used in this sentence, with the target word marked by tildes: "${marked}".` : '')
    + ` Illustrate the word's meaning with a single, clear, concrete subject or scene.`
    + ` If the meaning is abstract, represent it through a concrete everyday image`
    + ` (for example: "freedom" as a bird leaving an open cage; "fecund/fertile" as a mother with many children or lush blossoming plants; "nostalgia" as a box of old photographs).`
    + (imageTerm ? ` A fitting concrete subject could be: ${imageTerm}.` : '')
    + ` Use a plain, uncluttered background.`
    + ` Do NOT render any text, letters, words, numbers, captions, labels, or signs anywhere in the image.`;
  try {
    const img = await generateOpenAiImage(prompt);
    logger.info('generateWordImage: generated image for "%s" (%d bytes)', word, img.buffer.length);
    return img;
  } catch (err) {
    logger.error('generateWordImage failed for "%s": %s', word, err.message);
    return null;
  }
}
