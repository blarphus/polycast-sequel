/**
 * Shared normalization helpers for word forms and lemmas.
 * Used by enrichWord.js and stream-words.js.
 */

/**
 * Parse a comma-separated forms string into a JSON array string.
 * Returns null if fewer than 2 forms.
 */
export function normalizeForms(rawForms) {
  if (!rawForms) return null;
  const formsList = rawForms.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (formsList.length > 1) return JSON.stringify(formsList);
  return null;
}

/**
 * Normalize a lemma value: prefix English verbs with "to ", nullify empty.
 */
export function normalizeLemma(lemma, partOfSpeech, targetLang) {
  let normalized = lemma?.trim() || null;
  if (normalized && partOfSpeech === 'verb' && (targetLang === 'en' || targetLang?.startsWith('en-'))) {
    if (!normalized.startsWith('to ')) normalized = 'to ' + normalized;
  }
  return normalized;
}
