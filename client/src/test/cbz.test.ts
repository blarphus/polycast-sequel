import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseCbzPrototype } from '../utils/cbz';

describe('CBZ prototype importer', () => {
  const streamedFile = (archive: Uint8Array, name: string) => {
    const file = new File([archive as BlobPart], name, { type: 'application/zip' });
    Object.defineProperty(file, 'stream', {
      value: () => new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(archive);
          controller.close();
        },
      }),
    });
    return file;
  };

  it('streams and keeps only the two mapped speech pages', async () => {
    const archive = zipSync({
      'Supergirl - Woman of Tomorrow (2021-)-008.jpg': strToU8('not selected'),
      'Supergirl - Woman of Tomorrow (2021-)-009.jpg': strToU8('speech page one'),
      'Supergirl - Woman of Tomorrow (2021-)-010.jpg': strToU8('narration only'),
      'Supergirl - Woman of Tomorrow (2021-)-011.jpg': strToU8('speech page two'),
      'Supergirl - Woman of Tomorrow (2021-)-012.jpg': strToU8('not reached'),
    });
    const file = streamedFile(archive, 'Supergirl - Woman of Tomorrow.cbz');

    const comic = await parseCbzPrototype(file);

    expect(comic.pages).toHaveLength(2);
    expect(new TextDecoder().decode(comic.pages[0].image)).toBe('speech page one');
    expect(new TextDecoder().decode(comic.pages[1].image)).toBe('speech page two');
    expect(comic.pages[0].lines.length).toBeGreaterThan(40);
    expect(comic.pages[1].lines.length).toBeGreaterThan(50);
    expect(comic.prototypeNotice).toContain('only the first two pages');
  });

  it('reports the prototype mismatch visibly instead of silently opening another CBZ', async () => {
    const archive = zipSync({ 'different-comic-001.jpg': strToU8('page') });
    const file = streamedFile(archive, 'different.cbz');

    await expect(parseCbzPrototype(file)).rejects.toThrow('[cbz_prototype_mismatch]');
  });
});
