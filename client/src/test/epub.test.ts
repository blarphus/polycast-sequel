import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { coverBlob, parseEpub } from '../utils/epub';

function makeEpub(overrides: Record<string, string> = {}) {
  const files: Record<string, Uint8Array> = {
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
      <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles>
          <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
        </rootfiles>
      </container>`),
    'OPS/content.opf': strToU8(`<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>Fixture Book</dc:title>
          <dc:creator>Test Author</dc:creator>
          <dc:language>es-ES</dc:language>
        </metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
          <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
          <item id="c1" href="chapters/one.xhtml" media-type="application/xhtml+xml"/>
          <item id="c2" href="chapters/two.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine>
          <itemref idref="c1"/>
          <itemref idref="c2"/>
        </spine>
      </package>`),
    'OPS/nav.xhtml': strToU8(`<!doctype html>
      <html><body><nav epub:type="toc">
        <ol>
          <li><a href="chapters/one.xhtml">Opening</a></li>
          <li><a href="chapters/two.xhtml">Second</a></li>
        </ol>
      </nav></body></html>`),
    'OPS/chapters/one.xhtml': strToU8(`<!doctype html>
      <html><body>
        <h1>Chapter One</h1>
        <p>Hello world. Another sentence!</p>
        <img src="../images/pic.png" />
      </body></html>`),
    'OPS/chapters/two.xhtml': strToU8(`<!doctype html>
      <html><body>
        <h2>Next Part</h2>
        <p>Relative paths should still work.</p>
      </body></html>`),
    'OPS/images/cover.jpg': new Uint8Array([255, 216, 255, 217]),
    'OPS/images/pic.png': new Uint8Array([137, 80, 78, 71]),
  };

  for (const [path, value] of Object.entries(overrides)) {
    files[path] = strToU8(value);
  }

  return zipSync(files);
}

describe('parseEpub', () => {
  it('parses metadata, spine chapters, toc labels, text, images, and cover', () => {
    const parsed = parseEpub(makeEpub());

    expect(parsed.title).toBe('Fixture Book');
    expect(parsed.author).toBe('Test Author');
    expect(parsed.language).toBe('es');
    expect(parsed.coverHref).toBe('OPS/images/cover.jpg');
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters.map((chapter) => chapter.label)).toEqual(['Opening', 'Second']);
    expect(parsed.chapters[0].blocks[0]).toEqual({ type: 'h1', sentences: ['Chapter One'] });
    expect(parsed.chapters[0].blocks[1]).toEqual({
      type: 'p',
      sentences: ['Hello world.', 'Another sentence!'],
    });
    expect(parsed.chapters[0].blocks[2]).toEqual({
      type: 'img',
      imgHref: 'OPS/images/pic.png',
    });

    const cover = coverBlob(parsed);
    expect(cover?.type).toBe('image/jpeg');
    expect(cover?.size).toBe(4);
  });

  it('infers Spanish language when EPUB metadata omits dc:language', () => {
    const parsed = parseEpub(makeEpub({
      'OPS/content.opf': `<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>Fixture Book</dc:title>
            <dc:creator>Test Author</dc:creator>
          </metadata>
          <manifest>
            <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
            <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
            <item id="c1" href="chapters/one.xhtml" media-type="application/xhtml+xml"/>
          </manifest>
          <spine>
            <itemref idref="c1"/>
          </spine>
        </package>`,
      'OPS/chapters/one.xhtml': `<!doctype html>
        <html><body>
          <p>El chico sabe que la noche es larga, pero no puede salir.</p>
          <p>La casa de los amigos está cerca del parque y hay una luz.</p>
        </body></html>`,
    }));

    expect(parsed.language).toBe('es');
  });

  it('rejects archives without an OPF', () => {
    expect(() => parseEpub(zipSync({ 'META-INF/container.xml': strToU8('<container />') })))
      .toThrow('Invalid EPUB: no OPF found');
  });

  it('falls back to finding an OPF when the container entry is missing', () => {
    const parsed = parseEpub(zipSync({
      'content.opf': strToU8(`<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>Loose OPF</dc:title>
          </metadata>
          <manifest>
            <item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/>
          </manifest>
          <spine>
            <itemref idref="chapter"/>
          </spine>
        </package>`),
      'text/chapter.xhtml': strToU8('<html><body><p>Readable fallback chapter.</p></body></html>'),
    }));

    expect(parsed.title).toBe('Loose OPF');
    expect(parsed.chapters[0].blocks[0]).toEqual({
      type: 'p',
      sentences: ['Readable fallback chapter.'],
    });
  });
});
