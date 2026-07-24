// ---------------------------------------------------------------------------
// utils/tildeMarkup.tsx -- Shared ~word~ markup parsing helpers
// ---------------------------------------------------------------------------

/** Parse ~word~ markup into JSX with highlighted spans using the given class. */
export function renderTildeHighlight(text: string, className: string) {
  const parts = text.split(/~([^~]+)~/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className={className}>{part}</span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highlight a saved word in its source sentence. Explicit ~selection~ markup
 * wins; otherwise surface and lemma candidates use Unicode token boundaries. */
export function renderSavedWordHighlight(
  text: string,
  candidates: Array<string | null | undefined>,
  className: string,
) {
  if (/~[^~]+~/.test(text)) return renderTildeHighlight(text, className);
  const words = [...new Set(
    candidates
      .map((candidate) => String(candidate || '').trim())
      .filter(Boolean),
  )].sort((a, b) => b.length - a.length);
  if (words.length === 0) return text;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])(${words.map(escapePattern).join('|')})(?![\\p{L}\\p{M}\\p{N}])`,
    'giu',
  );
  const parts = text.split(pattern);
  return parts.map((part, index) => (
    index % 2 === 1
      ? <span key={index} className={className}>{part}</span>
      : <span key={index}>{part}</span>
  ));
}

/** Strip ~tildes~ from example sentence for TTS playback. */
export function stripTildes(text: string): string {
  return text.replace(/~([^~]+)~/g, '$1');
}

/** Return the contents of the first ~word~ span (tildes stripped), or null.
 *  Used to identify a card's own target word so it can be excluded from
 *  tap-to-add. */
export function tildeWord(text: string): string | null {
  const m = text.match(/~([^~]+)~/);
  return m ? m[1] : null;
}
