import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dictionary detail image layout', () => {
  it('bounds the image stage without cropping the source image', () => {
    const css = fs.readFileSync(path.resolve('src/styles/dictionary.css'), 'utf8');

    expect(css).toMatch(/\.dict-hero-image\s*\{[\s\S]*height:\s*clamp\(/);
    expect(css).toMatch(
      /\.dict-hero-image\s*>\s*img\s*\{[\s\S]*width:\s*100%[\s\S]*height:\s*100%[\s\S]*object-fit:\s*contain[\s\S]*object-position:\s*center/,
    );
    expect(css).not.toMatch(/\.dict-hero-image\s*>\s*img\s*\{[\s\S]*?object-fit:\s*cover/);
  });
});
