import { describe, expect, it } from 'vitest';
import source from '../pages/Settings.tsx?raw';
import css from '../styles/settings.css?raw';

describe('settings controls', () => {
  it('owns the back and daily-stepper styles in the settings route bundle', () => {
    expect(source).toContain('className="channel-back-btn settings-back-btn"');
    expect(css).toMatch(/\.settings-back-btn\s*\{[\s\S]*appearance:\s*none/);
    expect(css).toMatch(/\.daily-limit-btn\s*\{[\s\S]*appearance:\s*none/);
    expect(css).toMatch(/\.daily-limit-stepper\s*\{[\s\S]*grid-template-columns:\s*38px 46px 38px/);
  });

  it('gives all five texture options room and stacks controls on narrow screens', () => {
    expect(css).toMatch(/\.texture-toggle-option\s*\{[\s\S]*flex:\s*1 1 0/);
    expect(css).toMatch(/@media \(max-width:\s*560px\)[\s\S]*\.texture-toggle-row[\s\S]*grid-template-columns:\s*1fr/);
  });
});
