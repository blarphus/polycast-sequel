import { describe, expect, it } from 'vitest';
import { languageDisplayName, translate, uiLanguage, wordPopupLabels } from '../i18n';

describe('English and Spanish interface localization', () => {
  it('selects Spanish from Spanish native profiles and English otherwise', () => {
    expect(uiLanguage('es-MX')).toBe('es');
    expect(uiLanguage('en-US')).toBe('en');
    expect(uiLanguage(null)).toBe('en');
  });

  it('localizes controls, interpolation, language names, and shared popup actions', () => {
    expect(translate('es', 'nav.dictionary')).toBe('Diccionario');
    expect(translate('es', 'dictionary.count', { count: 2, countLabel: 'palabras' })).toBe('2 palabras');
    expect(languageDisplayName('en', 'es').toLocaleLowerCase()).toContain('inglés');
    expect(wordPopupLabels('es').addToDictionary).toBe('+ Agregar al diccionario');
    expect(wordPopupLabels('en').addToDictionary).toBe('+ Add to dictionary');
  });
});
