import { useEffect, useRef, useState } from 'react';

interface FallbackEventDetail {
  languageCode?: string;
  title?: string;
  message?: string;
  detail?: string;
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
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const showNotice = (next: { title: string; message: string }) => {
      setNotice(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setNotice(null), 7000);
    };

    const handleTtsFallback = (event: Event) => {
      const detail = (event as CustomEvent<FallbackEventDetail>).detail;
      const language = languageName(detail?.languageCode);
      showNotice({
        title: 'Voice fallback used',
        message: `Cloudflare does not support ${language} yet. Using the OpenAI voice fallback.`,
      });
    };

    const handleFallback = (event: Event) => {
      const detail = (event as CustomEvent<FallbackEventDetail>).detail;
      const message = [detail?.message, detail?.detail].filter(Boolean).join(' ');
      showNotice({
        title: detail?.title || 'Fallback used',
        message: message || 'Polycast used a fallback path.',
      });
    };

    window.addEventListener('polycast:tts-fallback', handleTtsFallback);
    window.addEventListener('polycast:fallback', handleFallback);
    return () => {
      window.removeEventListener('polycast:tts-fallback', handleTtsFallback);
      window.removeEventListener('polycast:fallback', handleFallback);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!notice) return null;

  return (
    <div className="tts-fallback-toast" role="status">
      <span aria-hidden="true">!</span>
      <span>
        <strong>{notice.title}</strong>
        <span>{notice.message}</span>
      </span>
    </div>
  );
}
