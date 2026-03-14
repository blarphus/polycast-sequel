import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { translatePhrase } from '../api';

interface PhrasePopupState {
  phrase: string;
  rect: DOMRect;
}

export default function PhraseTranslator() {
  const { user } = useAuth();
  const [popup, setPopup] = useState<PhrasePopupState | null>(null);
  const [translation, setTranslation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);

  const isTeacher = user?.account_type === 'teacher';
  const targetLang = user?.target_language;
  const nativeLang = user?.native_language || 'en';

  const dismiss = useCallback(() => {
    setPopup(null);
    setTranslation('');
    setError(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isTeacher) return;
    const handleMouseUp = () => {
      // Small delay to let the selection finalize
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;

        const text = sel.toString().trim();
        // Only trigger for multi-character selections (not single word clicks)
        if (text.length < 2) return;
        // Skip if selection is inside the phrase popup itself
        const anchorNode = sel.anchorNode;
        if (anchorNode && popupRef.current?.contains(anchorNode)) return;

        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setPopup({ phrase: text.slice(0, 500), rect });
      });
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [isTeacher]);

  // Dismiss on click outside or escape
  useEffect(() => {
    if (!popup) return undefined;

    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        dismiss();
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };

    // Delay listener so the mouseup that opened the popup doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleKey);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [popup, dismiss]);

  // Fetch translation when popup opens
  useEffect(() => {
    if (!popup || !targetLang) return;

    const id = ++requestIdRef.current;
    setLoading(true);
    setTranslation('');
    setError(false);

    translatePhrase(popup.phrase, nativeLang, targetLang)
      .then((res) => {
        if (id !== requestIdRef.current) return;
        setTranslation(res.translation);
        setLoading(false);
      })
      .catch((err) => {
        if (id !== requestIdRef.current) return;
        console.error('Phrase translation failed:', err);
        setError(true);
        setLoading(false);
      });
  }, [popup, targetLang, nativeLang]);

  if (!popup || isTeacher) return null;

  // Position popup above selection, flip below if near top
  const popupWidth = 320;
  let left = popup.rect.left + popup.rect.width / 2 - popupWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));

  let top = popup.rect.top - 8;
  let transformOrigin = 'bottom center';
  if (top < 100) {
    top = popup.rect.bottom + 8;
    transformOrigin = 'top center';
  }

  return (
    <div
      ref={popupRef}
      className="phrase-popup"
      style={{
        position: 'fixed',
        top,
        left,
        width: popupWidth,
        transform: top < popup.rect.top ? 'translateY(0)' : 'translateY(-100%)',
        transformOrigin,
        zIndex: 9999,
      }}
    >
      <div className="phrase-popup-phrase">{popup.phrase}</div>
      <div className="phrase-popup-divider" />
      {loading && (
        <div className="phrase-popup-loading">
          <div className="loading-spinner loading-spinner--small" />
        </div>
      )}
      {error && (
        <div className="phrase-popup-error">Translation failed</div>
      )}
      {!loading && !error && translation && (
        <div className="phrase-popup-translation">{translation}</div>
      )}
    </div>
  );
}
