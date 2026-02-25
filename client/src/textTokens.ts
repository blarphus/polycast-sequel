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
}
