import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dictionary detail image layout', () => {
  it('bounds the image stage without cropping the source image', () => {
    const css = fs.readFileSync(path.resolve('src/styles/dictionary.css'), 'utf8');

    expect(css).toMatch(/\.dict-hero-image\s*\{[\s\S]*height:\s*clamp\(/);
    expect(css).toMatch(
      /\.dict-image-viewer\s*\{[\s\S]*background-position:\s*center[\s\S]*background-repeat:\s*no-repeat[\s\S]*background-size:\s*contain/,
    );
    expect(css).not.toMatch(/\.dict-image-viewer\s*\{[\s\S]*?background-size:\s*cover/);
  });
});
