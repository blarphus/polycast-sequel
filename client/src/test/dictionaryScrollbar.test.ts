import { describe, expect, it } from 'vitest';
import css from '../styles/dictionary.css?raw';

describe('dictionary workspace scrollbars', () => {
  it('keeps persistent, styled scrollbars visible in both columns', () => {
    expect(css).toMatch(/\.dict-ladder-list-scroll\s*\{[\s\S]*overflow-y:\s*scroll/);
    expect(css).toMatch(/\.dict-ladder-list-scroll\s*\{[\s\S]*scrollbar-gutter:\s*stable/);
    expect(css).toMatch(/\.dict-detail-panel\s*\{[\s\S]*overflow-y:\s*scroll/);
    expect(css).toMatch(/\.dict-detail-panel\s*\{[\s\S]*scrollbar-gutter:\s*stable/);
    expect(css).toContain('.dict-ladder-list-scroll::-webkit-scrollbar');
    expect(css).toContain('.dict-detail-panel::-webkit-scrollbar');
    expect(css).toContain('.dict-detail-panel::-webkit-scrollbar-thumb');
  });
});
