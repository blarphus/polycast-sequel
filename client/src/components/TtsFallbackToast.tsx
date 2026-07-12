import { useEffect, useRef, useState } from 'react';
import { normalizeFallbackDiagnostic, type FallbackDiagnostic } from '../utils/fallbackDiagnostics';

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
  const [notice, setNotice] = useState<FallbackDiagnostic | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const showNotice = (next: FallbackDiagnostic) => {
      setNotice(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setNotice(null), 7000);
    };

    const handleTtsFallback = (event: Event) => {
      const detail = (event as CustomEvent<Partial<FallbackDiagnostic>>).detail;
      const language = languageName(detail?.languageCode);
      showNotice(normalizeFallbackDiagnostic({
        code: 'tts_provider_fallback',
        severity: 'warning',
        title: 'Voice fallback used',
        message: `Cloudflare does not support ${language} yet. Using the OpenAI voice fallback.`,
        languageCode: detail?.languageCode,
      }, { source: 'web.tts', operation: 'synthesize-speech' }));
    };

    const handleFallback = (event: Event) => {
      const detail = (event as CustomEvent<Partial<FallbackDiagnostic>>).detail;
      showNotice(normalizeFallbackDiagnostic(detail, { source: 'web.unknown', operation: 'unknown' }));
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
      <span className="fallback-toast-body">
        <strong>{notice.title}</strong>
        <span>{notice.message}</span>
        {notice.detail && <span className="fallback-toast-detail">{' '}{notice.detail}</span>}
        <small>{notice.code} · {notice.source}/{notice.operation} · ref {notice.correlationId}</small>
      </span>
    </div>
  );
}
