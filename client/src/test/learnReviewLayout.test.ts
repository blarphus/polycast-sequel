import { describe, expect, it } from 'vitest';
import css from '../styles/learn.css?raw';
import source from '../pages/Learn.tsx?raw';
import { getHighlightedPrompt, getInstructionText } from '../pages/Learn';

describe('flashcard review workspace', () => {
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

  it('supports reveal, incorrect, and correct keyboard controls', () => {
    expect(source).toContain("event.key === ' ' || event.key === 'Enter'");
    expect(source).toContain("event.key === '1'");
    expect(source).toContain("event.key === '2'");
  });
});
