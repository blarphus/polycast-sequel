import { describe, expect, it } from 'vitest';
import { translate } from '../i18n';

describe('Practice localization', () => {
  it('covers the empty state and session controls in Spanish', () => {
    expect(translate('es', 'practice.title')).toBe('Práctica');
    expect(translate('es', 'practice.minimumWords')).toContain('cuatro palabras');
    expect(translate('es', 'practice.openDictionary')).toBe('Abrir diccionario');
    expect(translate('es', 'practice.check')).toBe('Comprobar');
    expect(translate('es', 'practice.complete')).toBe('Práctica completada');
  });
});
