// ---------------------------------------------------------------------------
// lib/googleTranslate.js — thin wrapper around the public translate_a/single
// endpoint, shared by the translate route, the dictionary sentence-translate
// route, and the word-semantics service.
// ---------------------------------------------------------------------------

/**
 * Translate `text` from `sourceLang` to `targetLang` using Google's public
 * gtx endpoint. Returns the concatenated translation string.
 *
 * `sourceLang` may be 'auto' to let Google detect the source language.
 * Throws (no fallback) if the request fails — callers decide how to surface it.
 */
export async function translateText(text, sourceLang, targetLang) {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx` +
    `&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}` +
    `&dt=t&q=${encodeURIComponent(text)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Translate responded ${res.status}`);
  }

  const data = await res.json();
  // Response format: [[["translated text","original text",null,null,N], ...], ...]
  const segments = data[0] || [];
  return segments.map((seg) => seg[0] || '').join('');
}
