import { describe, expect, it } from 'vitest';
import { isAutoplayBlocked } from '../pages/Learn';

describe('flashcard autoplay handling', () => {
  it('recognizes browser user-gesture rejections', () => {
    expect(isAutoplayBlocked(new DOMException('play() failed because the user did not interact', 'NotAllowedError'))).toBe(true);
    expect(isAutoplayBlocked(new Error("play() failed because the user didn't interact with the document first."))).toBe(true);
  });

  it('does not misclassify genuine prepared-media failures', () => {
    expect(isAutoplayBlocked(new Error('Prepared speech metadata could not load.'))).toBe(false);
  });
});
