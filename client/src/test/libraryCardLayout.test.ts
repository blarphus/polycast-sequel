import { describe, expect, it } from 'vitest';
import css from '../styles/epub.css?raw';

describe('Library card layout', () => {
  it('keeps each book card at its own content height', () => {
    expect(css).toMatch(/\.epub-grid\s*\{[^}]*align-items:\s*start;/);
  });
});
