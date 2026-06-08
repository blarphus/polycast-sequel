import { fetchImageBytes } from './imageSearch.js';
import { callGeminiVision } from './gemini.js';
import logger from '../logger.js';

/**
 * Given candidate image URLs for a word, download them and ask Gemini (vision)
 * which one best depicts the word's meaning in its sentence context. This fixes
 * the "abstract word -> wrong stock photo" problem (e.g. "childishness" pulling
 * a photo of monkeys) that taking the first search result produced.
 *
 * Returns { url, buffer, contentType } for the winning image, or null if no
 * candidate could be downloaded OR the model judges that none of them reasonably
 * depict the word (caller then falls back to generating an image).
 *
 * @param {object} opts
 * @param {string} opts.word        - the saved word
 * @param {string} opts.definition  - its definition (gives the model the meaning)
 * @param {string} opts.sentence    - the sentence the user clicked it in
 * @param {string[]} opts.candidates - candidate image URLs
 */
export async function pickBestImage({ word, definition, sentence, candidates }) {
  // Download all candidates in parallel; keep only the ones that succeed.
  const downloaded = (await Promise.all(
    candidates.map(async (url) => {
      const bytes = await fetchImageBytes(url);
      return bytes ? { url, ...bytes } : null;
    }),
  )).filter(Boolean);

  if (downloaded.length === 0) return null;
  if (downloaded.length === 1) return downloaded[0];

  const parts = [{
    text: `A language learner saved the word "${word}" (meaning: ${definition})`
      + `${sentence ? ` from the sentence: "${sentence}"` : ''}.\n`
      + `Below are ${downloaded.length} candidate images, numbered 0 to ${downloaded.length - 1}. `
      + `Pick the ONE image that most clearly and accurately illustrates the meaning of "${word}" `
      + `for a flashcard. Prefer a clean photograph of a single, literal, unambiguous subject. `
      + `Avoid images containing text, captions, watermarks, charts, diagrams, or collages. `
      + `Reply with ONLY the index number, or -1 if NONE of the images reasonably depict the word `
      + `(or all of them are cluttered with text/diagrams).`,
  }];
  downloaded.forEach((img, i) => {
    parts.push({ text: `Image ${i}:` });
    parts.push({ inlineData: { mimeType: img.contentType, data: img.buffer.toString('base64') } });
  });

  let text;
  try {
    // thinkingBudget: 0 — gemini-flash-latest is a thinking model and will spend
    // the whole token budget "thinking" and return no text otherwise.
    text = await callGeminiVision(parts, { maxOutputTokens: 16, temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
  } catch (err) {
    // Vision pick failed — log it (visible, not swallowed) and use the first
    // candidate, which is the same result the old top-1 path would have given.
    logger.error('pickBestImage vision call failed for "%s": %s', word, err.message);
    return downloaded[0];
  }

  const match = text.match(/-?\d+/);
  const idx = match ? parseInt(match[0], 10) : 0;
  if (idx === -1) {
    logger.info('pickBestImage "%s": none of %d candidates fit — falling back to generation', word, downloaded.length);
    return null;
  }
  if (!Number.isInteger(idx) || idx < 0 || idx >= downloaded.length) {
    logger.info('pickBestImage "%s": unparseable pick "%s", using candidate 0', word, text.trim());
    return downloaded[0];
  }
  logger.info('pickBestImage "%s": chose %d of %d candidates', word, idx, downloaded.length);
  return downloaded[idx];
}
