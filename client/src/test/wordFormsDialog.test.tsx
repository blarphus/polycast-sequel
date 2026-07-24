import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WordFormsDialog from '../components/WordFormsDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../api', () => ({
  getSpanishConjugations: async () => ({
    verb: 'sacar',
    region: 'castellano',
    variants: [{
      info: { model: 'sacar', region: 'castellano' },
      conjugation: {
        Impersonal: { Infinitivo: 'sacar', Gerundio: 'sacando', Participio: 'sacado' },
        Indicativo: {
          Presente: ['saco', 'sacas', 'saca', 'sacamos', 'sacáis', 'sacan'],
          PreteritoIndefinido: ['saqué', 'sacaste', 'sacó', 'sacamos', 'sacasteis', 'sacaron'],
        },
        Subjuntivo: { Presente: ['saque', 'saques', 'saque', 'saquemos', 'saquéis', 'saquen'] },
        Imperativo: { Afirmativo: ['-', 'saca', '-', 'saquemos', 'sacad', '-'] },
      },
    }],
  }),
}));

describe('WordFormsDialog', () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container.remove();
    document.querySelector('.dict-conjugation-overlay')?.remove();
    root = undefined;
  });

  async function waitForText(text: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (container.textContent?.includes(text)) return;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }
    throw new Error(`Timed out waiting for “${text}”`);
  }

  it('replaces the flat Spanish verb list with navigable tense tables', async () => {
    act(() => {
      root?.render(
        <WordFormsDialog
          word="sacar"
          lemma="sacar"
          targetLanguage="es"
          partOfSpeech="verb"
          forms={['saco', 'saqué', 'sacado', 'sacar', 'sacando', 'sacas', 'saca']}
        />,
      );
    });

    expect(container.textContent).toContain('View conjugations');
    expect(container.textContent).not.toContain('saco, saqué');

    act(() => {
      container.querySelector<HTMLButtonElement>('.dict-forms-trigger')?.click();
    });
    await waitForText('sacáis');

    const modal = container.querySelector('.dict-conjugation-modal');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Present');
    expect(modal?.textContent).toContain('saco');
    expect(modal?.textContent).toContain('sacáis');

    const preterite = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.dict-conjugation-tenses button'),
    ).find((button) => button.textContent === 'Preterite');
    act(() => preterite?.click());

    expect(modal?.textContent).toContain('saqué');
    expect(modal?.textContent).toContain('sacaron');

    const additionalForms = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.dict-conjugation-moods button'),
    ).find((button) => button.textContent === 'Additional forms');
    act(() => additionalForms?.click());

    expect(modal?.textContent).toContain('Regional, alternate, and attached-pronoun forms');
    expect(modal?.textContent).toContain('sacando');
  });
});
