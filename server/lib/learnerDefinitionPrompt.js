/**
 * Shared quality rules for learner-facing dictionary definitions.
 *
 * These rules were tuned against ambiguous English and Spanish words, fixed
 * phrases, false friends, and inflected forms with a 14-year-old learner as
 * the intended reader.
 */
export function learnerDefinitionRules(nativeLanguage, {
  field = 'definition',
  translationField = 'translation',
} = {}) {
  const language = nativeLanguage || 'the learner\'s native language';
  return `Learner-facing ${field} rules:
- Write for a 14-year-old language learner.
- Define the reusable core meaning of this exact sense, not the example's story.
- Define the selected word or phrase itself, not the nearby noun, person, or action it describes.
- Keep the definition consistent with the selected word's part of speech.
- Use one direct sentence of 4-11 common ${language} words.
- Every detail must be required by the word itself in this sense.
- Do not add typical details such as force, difficulty, direction, ownership, intention, timing, or position.
- Do not compare this sense with another meaning of the word.
- Do not repeat the ${translationField}, the target word, or an obvious same-root form in the ${field}.
- Replace technical or abstract labels with familiar words whenever meaning stays accurate.
- Do not begin with "this word", "means", "significa", or similar framing.
- Before returning, count the words and remove any detail not required by the meaning.

Quality examples:
- Too specific: "To throw a ball forcefully." Better: "To send something through the air with your hand."
- Invented detail: "Elevated land beside a river." Better: "Land beside a river."
- Circular: translation "worried"; definition "Feeling worried." Better: "Feeling uneasy because something may be wrong."
- Too technical: "A financial institution." Better: "A business that keeps and manages people's money."`;
}

export function learnerTranslationRules(nativeLanguage, {
  field = 'translation',
} = {}) {
  return `${field}: give a canonical 1-4 word dictionary translation in ${nativeLanguage || 'the learner\'s native language'}; use an infinitive for verbs when natural.`;
}
