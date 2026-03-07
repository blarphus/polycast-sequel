import { request } from './core';

export function translatePhrase(
  phrase: string,
  nativeLang: string,
  targetLang: string,
): Promise<{ translation: string }> {
  return request('/translate/phrase', {
    method: 'POST',
    body: { phrase, nativeLang, targetLang },
  });
}
