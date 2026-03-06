import { useCallback, useState } from 'react';
import { translateSentence } from '../api';

interface UseMessageTranslationsOptions {
  nativeLang?: string;
  targetLang?: string;
}

export function useMessageTranslations({ nativeLang, targetLang }: UseMessageTranslationsOptions) {
  const [translations, setTranslations] = useState<Map<string, string>>(new Map());
  const [translating, setTranslating] = useState<Set<string>>(new Set());

  const handleTranslate = useCallback(async (messageId: string, body: string) => {
    if (!nativeLang || translations.has(messageId) || translating.has(messageId)) return;

    setTranslating((prev) => new Set(prev).add(messageId));
    try {
      const { translation } = await translateSentence(body, targetLang || '', nativeLang);
      setTranslations((prev) => new Map(prev).set(messageId, translation));
    } catch (err) {
      console.error('Failed to translate message:', err);
    } finally {
      setTranslating((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }
  }, [nativeLang, targetLang, translating, translations]);

  return {
    handleTranslate,
    translating,
    translations,
  };
}
