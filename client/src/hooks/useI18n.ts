import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { languageDisplayName, translate, uiLanguage } from '../i18n';

export function useI18n() {
  const { user } = useAuth();
  const language = uiLanguage(user?.native_language);
  return useMemo(() => ({
    language,
    t: (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate(language, key, values),
    languageName: (code: string) => languageDisplayName(code, language),
  }), [language]);
}
