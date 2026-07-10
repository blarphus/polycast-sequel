import { fetchImageBytes } from './imageSearch.js';
import { callGeminiVision, parseGeminiJson } from './gemini.js';
import logger from '../logger.js';

/**
 * Given candidate image URLs for a word, download them and ask Gemini (vision)
 * which one best depicts the word's meaning in its sentence context. This fixes
 * the "abstract word -> wrong stock photo" problem (e.g. "childishness" pulling
 * a photo of monkeys) that taking the first search result produced.
 *
 * Returns { url, buffer, contentType, sceneDescription } for the winning image, or null if no
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

  const parts = [{
    text: `A language learner saved the word "${word}" (meaning: ${definition})`
      + `${sentence ? ` from the sentence: "${sentence}"` : ''}.\n`
      + `Below are ${downloaded.length} candidate images, numbered 0 to ${downloaded.length - 1}. `
      + `Pick the ONE image that most clearly and accurately illustrates the meaning of "${word}" `
      + `for a flashcard. Prefer a clean photograph of a single, literal, unambiguous subject. `
      + `Avoid images containing text, captions, watermarks, charts, diagrams, or collages. `
      + `Return ONLY JSON in this exact shape: {"index":0,"scene_description":"..."}. `
      + `Use index -1 and scene_description null if NONE reasonably depict the word. `
      + `For the selected image, scene_description must be one short English sentence describing `
      + `only the concrete subjects, actions, setting, and mood visibly present.`,
  }];
  downloaded.forEach((img, i) => {
    parts.push({ text: `Image ${i}:` });
    parts.push({ inlineData: { mimeType: img.contentType, data: img.buffer.toString('base64') } });
  });

  let text;
  try {
    // thinkingBudget: 0 — gemini-flash-latest is a thinking model and will spend
    // the whole token budget "thinking" and return no text otherwise.
    text = await callGeminiVision(parts, {
      maxOutputTokens: 120,
      temperature: 0,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
    });
  } catch (err) {
    // Vision pick failed — log it (visible, not swallowed) and use the first
    // candidate, which is the same result the old top-1 path would have given.
    logger.error('pickBestImage vision call failed for "%s": %s', word, err.message);
    return {
      ...downloaded[0],
      fallbackNotice: {
        title: 'Image picker fallback used',
        message: `Gemini image selection failed for "${word}": ${err.message}. Using the first image candidate.`,
      },
    };
  }

  let parsed;
  try {
    parsed = parseGeminiJson(text, 'Image selection');
  } catch (err) {
    logger.error('pickBestImage returned invalid JSON for "%s": %s', word, err.message);
    return {
      ...downloaded[0],
      fallbackNotice: {
        title: 'Image picker fallback used',
        message: `Gemini returned an invalid image-selection response for "${word}". Using the first image candidate.`,
      },
    };
  }

  const idx = Number(parsed.index);
  if (idx === -1) {
    logger.info('pickBestImage "%s": none of %d candidates fit — falling back to generation', word, downloaded.length);
    return null;
  }
  if (!Number.isInteger(idx) || idx < 0 || idx >= downloaded.length) {
    logger.info('pickBestImage "%s": invalid pick "%s", using candidate 0', word, parsed.index);
    return {
      ...downloaded[0],
      fallbackNotice: {
        title: 'Image picker fallback used',
        message: `Gemini returned an invalid image choice for "${word}" ("${parsed.index}"). Using the first image candidate.`,
      },
    };
  }
  logger.info('pickBestImage "%s": chose %d of %d candidates', word, idx, downloaded.length);
  return {
    ...downloaded[idx],
    sceneDescription: String(parsed.scene_description || '').trim() || null,
  };
}
