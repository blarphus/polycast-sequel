// ---------------------------------------------------------------------------
// targetLanguageGuard.js -- Shared prompt rules that stop Gemini from
// "rescuing" a word that is not actually in the learner's target language
// (e.g. clicking the English word "require" with Spanish as target and getting
// it mapped to "requerir"). Every Gemini prompt that validates or interprets a
// clicked word must include the matching rule from here, so the policy stays
// consistent across all lookup paths.
// ---------------------------------------------------------------------------

/**
 * Rule for prompts whose JSON output has a `valid` flag (full dictionary
 * lookup). Tells Gemini to reject cross-language look-alikes outright.
 */
export function strictValidityRule({ word, targetLang, nativeLang }) {
  const target = targetLang || 'the target language';
  return `Be strict about language: if "${word}" as spelled is a word of ${nativeLang} or another language rather than ${target} (e.g. an English word on an English page), set valid to false — do NOT rescue it by mapping it to a similar-looking ${target} word. Only accept it if this exact spelling is a real ${target} dictionary form or inflection.`;
}

/**
 * Rule for sense-picker prompts that reply with an index (or -1 when nothing
 * fits). Covers cross-language homographs: the exact spelling may exist in the
 * target language, but the sentence shows it is being used as another
 * language's word.
 */
export function strictSensePickRule({ word, targetLang }) {
  const target = targetLang || 'the target language';
  return `If the sentence is clearly NOT ${target} and "${word}" is being used as a word of another language (a cross-language homograph), none of the ${target} senses apply — the PICK is -1.`;
}
