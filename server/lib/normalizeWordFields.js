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
 * Parse a forms value — JSON-array string (current), comma-separated string
 * (legacy), or array — into lowercased, trimmed, non-empty form strings.
 */
export function parseFormsValue(forms) {
  if (!forms) return [];
  let list = [];
  if (Array.isArray(forms)) {
    list = forms;
  } else if (typeof forms === 'string') {
    const trimmed = forms.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        list = trimmed.split(',');
      }
    } else {
      list = trimmed.split(',');
    }
  }
  return list.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
}

/**
 * Ensure `form` is present in a forms value, returning a JSON-array string of
 * the merged, de-duplicated forms (or null when empty). Unlike normalizeForms,
 * this keeps a single-element list so the exact surface form a learner tapped
 * is always stored — guaranteeing it highlights everywhere afterward.
 */
export function mergeForm(forms, form) {
  const list = parseFormsValue(forms);
  const f = String(form || '').trim().toLowerCase();
  if (f && !list.includes(f)) list.push(f);
  return list.length ? JSON.stringify(list) : null;
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
