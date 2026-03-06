import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '../api';
import { mergeTranscriptSegmentsForDisplay } from '../watchTranscript';

function segment(text: string, offset: number, duration: number): TranscriptSegment {
  return { text, offset, duration };
}

describe('mergeTranscriptSegmentsForDisplay', () => {
  it('merges obvious sentence fragments from the production transcript shape', () => {
    const merged = mergeTranscriptSegmentsForDisplay([
      segment('Acho que o capitão Pátria tá atrás desse', 30560, 4920),
      segment('veu.', 32680, 5399),
      segment('A primeira versão do composto V. Mas se', 35480, 4280),
      segment('o capitão Patra encontrar, ele vai ser', 38079, 4681),
      segment('imortal.', 39760, 3000),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].text).toBe('Acho que o capitão Pátria tá atrás desse veu.');
    expect(merged[0].offset).toBe(30560);
    expect(merged[0].duration).toBe(7519);
    expect(merged[1].text).toBe('A primeira versão do composto V. Mas se o capitão Patra encontrar, ele vai ser imortal.');
    expect(merged[1].offset).toBe(35480);
    expect(merged[1].duration).toBe(7280);
  });

  it('merges short continuation fragments into the same line', () => {
    const merged = mergeTranscriptSegmentsForDisplay([
      segment('>> Precisamos fugir enquanto der e do jeito', 43840, 3960),
      segment('que der.', 46239, 3640),
      segment('>> Precisamos preparar a América pra minha', 77320, 5680),
      segment('ascensão.', 80000, 3000),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].text).toBe('>> Precisamos fugir enquanto der e do jeito que der.');
    expect(merged[0].duration).toBe(6039);
    expect(merged[1].text).toBe('>> Precisamos preparar a América pra minha ascensão.');
  });

  it('keeps completed sentences and speaker changes separated', () => {
    const merged = mergeTranscriptSegmentsForDisplay([
      segment('Meu poder é absoluto.', 4440, 5000),
      segment('Alcançou um patamar jamais cogitado.', 9960, 9480),
      segment('>> Uau! Louvado seja.', 19600, 6200),
      segment('E qual é?', 22320, 3480),
      segment('Pode crer.', 106600, 5640),
    ]);

    expect(merged).toHaveLength(5);
    expect(merged.map((item) => item.text)).toEqual([
      'Meu poder é absoluto.',
      'Alcançou um patamar jamais cogitado.',
      '>> Uau! Louvado seja.',
      'E qual é?',
      'Pode crer.',
    ]);
  });

  it('does not merge across large gaps or overly long candidate lines', () => {
    const merged = mergeTranscriptSegmentsForDisplay([
      segment('Acho que o capitão Pátria tá atrás desse', 0, 500),
      segment('veu.', 2200, 400),
      segment('para aqueles que querem me destruir os descrentes e os traidores, eu ofereço', 5000, 500),
      segment('a aniquilação sem qualquer chance de redenção ou retorno seguro para ninguém aqui.', 5600, 500),
    ]);

    expect(merged).toHaveLength(4);
  });

  it('keeps punctuation-adjacent joins tight when a segment ends in a hyphen', () => {
    const merged = mergeTranscriptSegmentsForDisplay([
      segment('anti-', 0, 500),
      segment('herói', 520, 500),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('anti-herói');
  });

  it('decodes HTML entities before rendering and merging', () => {
    const merged = mergeTranscriptSegmentsForDisplay([
      segment('&gt;&gt; Precisamos preparar a América pra minha', 0, 2000),
      segment('ascensão.', 2100, 1000),
      segment('&quot;Vou seguir', 5000, 1000),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].text).toBe('>> Precisamos preparar a América pra minha ascensão.');
    expect(merged[1].text).toBe('"Vou seguir');
  });

  it('does not merge when the next segment starts with a speaker marker', () => {
    const merged = mergeTranscriptSegmentsForDisplay([
      segment('>> Você me comeu', 0, 900),
      segment('&gt;&gt; o quê?', 950, 900),
      segment('mesmo?', 1900, 900),
    ]);

    expect(merged).toHaveLength(3);
    expect(merged[0].text).toBe('>> Você me comeu');
    expect(merged[1].text).toBe('>> o quê?');
    expect(merged[2].text).toBe('mesmo?');
  });

  it('keeps speaker-marked lines split from the previous speaker turn', () => {
    const merged = mergeTranscriptSegmentsForDisplay([
      segment('Meu poder é absoluto.', 0, 1000),
      segment('&gt;&gt; Precisamos preparar a América pra minha', 1100, 1000),
      segment('ascensão.', 2200, 1000),
      segment('E qual é?', 3300, 1000),
    ]);

    expect(merged).toHaveLength(3);
    expect(merged[0].text).toBe('Meu poder é absoluto.');
    expect(merged[1].text).toBe('>> Precisamos preparar a América pra minha ascensão.');
    expect(merged[2].text).toBe('E qual é?');
  });

  it('keeps standalone cues separate from dialogue and lyrics', () => {
    const merged = mergeTranscriptSegmentsForDisplay([
      segment('[música]', 0, 1000),
      segment('Se você', 1100, 1000),
      segment('já pensou em desistir,', 2200, 1000),
      segment('>> [música]', 4000, 1000),
      segment('>> Se chorar,', 5100, 1000),
    ]);

    expect(merged).toHaveLength(4);
    expect(merged.map((item) => item.text)).toEqual([
      '[música]',
      'Se você já pensou em desistir,',
      '>> [música]',
      '>> Se chorar,',
    ]);
  });

  it('merges very short lead-ins when the next line clearly continues them', () => {
    const merged = mergeTranscriptSegmentsForDisplay([
      segment('Se você', 0, 1000),
      segment('já pensou em desistir,', 1100, 1000),
      segment('tenha fé.', 2200, 1000),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('Se você já pensou em desistir, tenha fé.');
  });
});
