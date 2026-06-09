import { useEffect, useRef, useState } from 'react';

interface FallbackEventDetail {
  languageCode?: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  de: 'German',
  fr: 'French',
  ja: 'Japanese',
  ko: 'Korean',
  pt: 'Portuguese',
  zh: 'Chinese',
};

function languageName(languageCode?: string) {
  const base = String(languageCode || '').trim().toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_NAMES[base] || languageCode || 'this language';
}

export default function TtsFallbackToast() {
  const [languageCode, setLanguageCode] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleFallback = (event: Event) => {
      const detail = (event as CustomEvent<FallbackEventDetail>).detail;
      setLanguageCode(languageName(detail?.languageCode));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setLanguageCode(null), 5000);
    };

    window.addEventListener('polycast:tts-fallback', handleFallback);
    return () => {
      window.removeEventListener('polycast:tts-fallback', handleFallback);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!languageCode) return null;

  return (
    <div className="tts-fallback-toast" role="status">
      <span aria-hidden="true">!</span>
      <span>Cloudflare does not support {languageCode} yet. Using the OpenAI voice fallback.</span>
    </div>
  );
}
