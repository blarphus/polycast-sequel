import logger from '../logger.js';
import { callGemini } from './gemini.js';

/**
 * Generate a new example sentence for a card at the next stage, using a
 * different form/inflection than the previous stages. Returns
 * { example, translation } with tildes around the target form on both sides,
 * matching the convention in enrichWord.js.
 *
 * Called by srsUpdate.js when a card advances to a new max stage >= 4.
 * One call per advance — never batched.
 *
 * @param {object} args
 * @param {string} args.word - The saved word (the surface form the user clicked)
 * @param {string} args.translation - Native-language translation
 * @param {string} args.definition - Native-language definition
 * @param {string|null} args.lemma - The dictionary headword (may be null)
 * @param {string|null} args.forms - Comma-separated inflected forms (may be null)
 * @param {string|null} args.partOfSpeech - noun/verb/adj/... (may be null)
 * @param {string|null} args.targetLang - Target language code (e.g. "es")
 * @param {string|null} args.nativeLang - Native language code (e.g. "en")
 * @param {Array<{example: string}>} args.previousSentences - Sentences used
 *   in earlier stages. Used to forbid reuse and to steer Gemini toward an
 *   unused form.
 * @returns {Promise<{example: string, translation: string}>}
 */
export async function generateStageSentence({
  word,
  translation,
  definition,
  lemma,
  forms,
  partOfSpeech,
  targetLang,
  nativeLang,
  previousSentences = [],
}) {
  const usedForms = previousSentences
    .map((entry) => extractTilded(entry.example))
    .filter((f) => f && f.length > 0);

  const usedSentences = previousSentences
    .map((entry) => stripTildes(entry.example))
    .filter((s) => s && s.length > 0);

  const formsList = (forms || '')
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && f.toLowerCase() !== word.toLowerCase());

  const prompt = `You are writing a NEW example sentence for a flashcard in ${targetLang || 'the target language'}.

The flashcard is for the word "${word}" (${translation || 'no translation'}${definition ? `; ${definition}` : ''}).
Part of speech: ${partOfSpeech || 'unknown'}
Lemma (dictionary headword): ${lemma || word}
Available inflected forms of the lemma: ${formsList.length > 0 ? formsList.join(', ') : '(none provided)'}

Previously used sentences for this card (do NOT repeat the topic or wording):
${usedSentences.length > 0 ? usedSentences.map((s, i) => `  ${i + 1}. ${s}`).join('\n') : '  (none yet)'}

Previously used forms inside tildes (do NOT reuse these):
${usedForms.length > 0 ? usedForms.map((f) => `  - ~${f}~`).join('\n') : '  (none yet)'}

Your job: write ONE short example sentence in ${targetLang || 'the target language'} that uses a DIFFERENT form/inflection of the lemma than the ones listed above. Pick a different subject, tense, or context so the user is tested on producing a new conjugation.

Output EXACTLY two fields separated by " // ", with no extra commentary:

EXAMPLE // SENTENCE_TRANSLATION

Where:
- EXAMPLE: a short sentence in ${targetLang || 'the target language'} using the word (preferably in a form from the "Available inflected forms" list). Wrap the inflected form with tildes like ~word~. Under 15 words. No markdown.
- SENTENCE_TRANSLATION: a natural ${nativeLang || 'native language'} translation of EXAMPLE. Wrap the translated equivalent of the tilded form with tildes in the same position. Same meaning and tone.

Only return the two fields. Nothing else.`;

  const raw = await callGemini(prompt);
  const parts = raw.split('//').map((s) => s.trim());
  if (parts.length < 2) {
    throw new Error(`Stage-sentence Gemini returned ${parts.length} parts (expected 2)`);
  }
  const example = parts[0];
  const translationOut = parts[1];
  if (!example || !translationOut) {
    throw new Error('Stage-sentence Gemini returned empty fields');
  }
  if (!example.includes('~') || !translationOut.includes('~')) {
    throw new Error('Stage-sentence Gemini returned fields without tilde-wrapped form');
  }
  return { example, translation: translationOut };
}

function extractTilded(sentence) {
  if (!sentence) return null;
  const match = sentence.match(/~([^~]+)~/);
  return match ? match[1].trim() : null;
}

function stripTildes(sentence) {
  if (!sentence) return '';
  return sentence.replace(/~/g, '');
}
