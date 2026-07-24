import { describe, expect, it } from 'vitest';
import css from '../styles/learn.css?raw';
import source from '../pages/Learn.tsx?raw';
import { getHighlightedPrompt, getInstructionText } from '../pages/Learn';

describe('flashcard review workspace', () => {
  it('keeps selected theme textures visible behind the review workspace', () => {
    expect(css).toContain('[data-bg-texture="dots"] .learn-review-page');
    expect(css).toContain('[data-bg-texture="grid"] .learn-review-page');
    expect(css).toMatch(/\[data-bg-texture="grid"\] \.learn-review-page\s*\{\s*background:\s*transparent;/);
  });

  it('asks about the highlighted phrase rather than the whole sentence', () => {
    const phrase = getHighlightedPrompt({
      word: 'manage',
      example_sentence: 'We ~managed to~ reach the top of the mountain.',
    });

    expect(phrase).toBe('managed to');
    expect(getInstructionText('sentence-meaning', phrase)).toBe('What does “managed to” mean?');
  });

  it('falls back to the saved word when a sentence has no marked phrase', () => {
    expect(getHighlightedPrompt({
      word: 'despite',
      example_sentence: 'Despite the rain, we continued.',
    })).toBe('despite');
  });

  it('uses the selected two-panel layout with responsive stacking', () => {
    expect(css).toMatch(/\.learn-review-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.72fr\)\s+minmax\(300px,\s*0\.92fr\)/s);
    expect(css).toMatch(/@media \(max-width:\s*960px\)[\s\S]*?\.learn-review-workspace\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(css).toMatch(/\.learn-review-answer-panel \.flashcard-answer-buttons\s*\{[^}]*grid-template-columns:\s*1fr/s);
  });

  it('makes the revealed translation the visual focus of the answer panel', () => {
    expect(css).toContain('.learn-review-workspace.is-revealed .learn-review-answer-panel');
    expect(css).toMatch(/\.learn-review-answer-translation\s*\{[\s\S]*font-size:\s*clamp\(1\.55rem,\s*2\.35vw,\s*2\.1rem\)/);
    expect(css).toContain('@keyframes learnTranslationReveal');
  });

  it('remounts each card image and preserves its full aspect ratio', () => {
    expect(source).toContain('key={`${card.id}:${card.image_url}`}');
    expect(source).toContain("classList.add('is-loaded')");
    expect(css).toMatch(/\.learn-review-image\.flashcard-image\s*\{[\s\S]*object-fit:\s*contain/);
  });

  it('supports reveal, incorrect, and correct keyboard controls', () => {
    expect(source).toContain("event.key === ' ' || event.key === 'Enter'");
    expect(source).toContain("event.key === '1'");
    expect(source).toContain("event.key === '2'");
  });

  it('prepares exact front and back speech before cards are revealed', () => {
    expect(source).toContain('prepareFlashcardsForStudy(user.id)');
    expect(source).toContain('warmFlashcardAudio(cards, currentIndex)');
    expect(source).toContain('ensureFlashcardSpeech(card, text)');
    expect(source).toContain('if (loading || !currentCard) return');
  });

  it('offers a dictionary-entry editor from the card menu', () => {
    expect(source).toContain('aria-label="Card menu"');
    expect(source).toContain('Edit dictionary entry');
    expect(source).toContain('<DictionaryEntryEditor');
  });
});
