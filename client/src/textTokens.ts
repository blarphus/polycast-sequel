// ---------------------------------------------------------------------------
// textTokens.ts -- Shared tokenization utilities for subtitle/transcript text
// ---------------------------------------------------------------------------

export function tokenize(text: string): string[] {
  return text.match(/([\p{L}\p{M}\d']+|[.,!?;:]+|\s+)/gu) || [];
}

export function isWordToken(token: string): boolean {
  return /^[\p{L}\p{M}\d']+$/u.test(token);
}

export interface PopupState {
  word: string;
  sentence: string;
  rect: DOMRect;
  // Wider rolling passage (recent ~50 words) for "Explain in context".
  context?: string;
}

/** Last `n` whitespace-separated words of `text` — the rolling explain window. */
export function lastNWords(text: string, n: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(-n).join(' ');
}
