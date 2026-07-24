import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderSavedWordHighlight } from '../utils/tildeMarkup';

describe('saved-from word highlighting', () => {
  it('highlights the stored surface form with Unicode token boundaries', () => {
    const html = renderToStaticMarkup(
      <>{renderSavedWordHighlight(
        'Después observo a Gary poniéndose de puntillas.',
        ['poniéndose', 'poner'],
        'saved-highlight',
      )}</>,
    );

    expect(html).toContain('<span class="saved-highlight">poniéndose</span>');
    expect(html).not.toContain('<span class="saved-highlight">poner</span>');
  });

  it('prefers explicit selection markup when it exists', () => {
    const html = renderToStaticMarkup(
      <>{renderSavedWordHighlight(
        'El ~ojo derecho~ está herido.',
        ['ojo'],
        'saved-highlight',
      )}</>,
    );

    expect(html).toContain('<span class="saved-highlight">ojo derecho</span>');
  });
});
