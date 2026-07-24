import { describe, expect, it } from 'vitest';
import source from '../hooks/useBooks.ts?raw';

describe('personal CBZ storage', () => {
  it('stores new comics on-device without calling the profile upload API', () => {
    const cbzBranch = source.slice(
      source.indexOf("if (file.name.toLowerCase().endsWith('.cbz'))"),
      source.indexOf('const bytes = new Uint8Array'),
    );

    expect(cbzBranch).toContain('await addBook(meta, comic)');
    expect(cbzBranch).toContain("source: 'personal'");
    expect(cbzBranch).not.toContain('uploadUserLibraryBook');
  });

  it('retains local comics when obsolete device-only EPUBs are cleaned up', () => {
    expect(source).toContain("&& book.format !== 'comic'");
  });
});
