import { useEffect, useRef, useState } from 'react';
import { normalizeFallbackDiagnostic, type FallbackDiagnostic } from '../utils/fallbackDiagnostics';

const LANGUAGE_NAMES: Record<string, string> = {
  de: 'German',
  fr: 'French',
  ja: 'Japanese',
  pt: 'Portuguese',
};

function languageName(languageCode?: string) {
  const base = String(languageCode || '').trim().toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_NAMES[base] || languageCode || 'this language';
}

export default function FallbackToast() {
  const [notice, setNotice] = useState<FallbackDiagnostic | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownCorrelationIds = useRef(new Set<string>());

  useEffect(() => {
    const showNotice = (next: FallbackDiagnostic) => {
      if (shownCorrelationIds.current.has(next.correlationId)) return;
      shownCorrelationIds.current.add(next.correlationId);
      setNotice(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setNotice(null), 7000);
    };

    const handleTtsFallback = (event: Event) => {
      const detail = (event as CustomEvent<Partial<FallbackDiagnostic> & { fallbackReason?: string }>).detail;
      const language = languageName(detail?.languageCode);
      const temporary = detail?.fallbackReason && detail.fallbackReason !== 'unsupported-language';
      showNotice(normalizeFallbackDiagnostic({
        code: 'tts_provider_fallback',
        severity: 'warning',
        title: 'Voice fallback used',
        message: temporary
          ? 'Cloudflare speech was temporarily unavailable. Using the OpenAI voice fallback.'
          : `Cloudflare does not support ${language} yet. Using the OpenAI voice fallback.`,
        languageCode: detail?.languageCode,
        detail: detail?.fallbackReason ? `reason=${detail.fallbackReason}` : undefined,
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
    <div className={`fallback-toast fallback-toast--${notice.severity}`} role="status" aria-live="polite">
      <span aria-hidden="true">{notice.severity === 'info' ? 'i' : '!'}</span>
      <span className="fallback-toast-body">
        <strong>{notice.title}</strong>
        <span>{notice.message}</span>
        {notice.detail && <span className="fallback-toast-detail">{' '}{notice.detail}</span>}
        <small>{notice.code} · {notice.source}/{notice.operation} · ref {notice.correlationId}</small>
      </span>
    </div>
  );
}
