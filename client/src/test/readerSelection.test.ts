import { describe, expect, it } from 'vitest';
import { getReaderSelectionDetails } from '../utils/readerSelection';

describe('getReaderSelectionDetails', () => {
  it('wraps a cross-token selection in tildes inside its paragraph', () => {
    const content = document.createElement('div');
    content.className = 'epub-content';
    content.innerHTML = '<p class="epub-p">Hola <span>mundo.</span> <span>Esto</span> sigue aquí.</p>';
    document.body.appendChild(content);

    const spans = content.querySelectorAll('span');
    const range = document.createRange();
    range.setStart(spans[0].firstChild!, 0);
    range.setEnd(spans[1].firstChild!, 4);

    expect(getReaderSelectionDetails(range, content)).toEqual({
      selection: 'mundo. Esto',
      context: 'Hola ~mundo. Esto~ sigue aquí.',
    });
    content.remove();
  });

  it('rejects selections spanning multiple paragraphs', () => {
    const content = document.createElement('div');
    content.innerHTML = '<p class="epub-p">First paragraph.</p><p class="epub-p">Second paragraph.</p>';
    document.body.appendChild(content);

    const paragraphs = content.querySelectorAll('p');
    const range = document.createRange();
    range.setStart(paragraphs[0].firstChild!, 0);
    range.setEnd(paragraphs[1].firstChild!, 6);

    expect(getReaderSelectionDetails(range, content)).toBeNull();
    content.remove();
  });
});
