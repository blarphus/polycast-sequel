import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.components.phrasetranslator');
import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { explainSelection, translatePhrase } from '../api';
import { getReaderSelectionDetails } from '../utils/readerSelection';

interface PhrasePopupState {
  phrase: string;
  context: string | null;
  rect: DOMRect;
}

export default function PhraseTranslator() {
  const { user } = useAuth();
  const [popup, setPopup] = useState<PhrasePopupState | null>(null);
  const [translation, setTranslation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanationError, setExplanationError] = useState('');
  const popupRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const explanationRequestIdRef = useRef(0);

  const isTeacher = user?.account_type === 'teacher';
  const targetLang = user?.target_language;
  const nativeLang = user?.native_language || 'en';

  const dismiss = useCallback(() => {
    explanationRequestIdRef.current += 1;
    setPopup(null);
    setTranslation('');
    setError(false);
    setLoading(false);
    setExplanation('');
    setExplanationError('');
    setExplanationLoading(false);
  }, []);

  useEffect(() => {
    if (isTeacher) return;
    const handleSelection = (event: Event) => {
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return;
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
        const selectionElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? range.commonAncestorContainer as Element
          : range.commonAncestorContainer.parentElement;
        const readerContent = selectionElement?.closest('.epub-content') as HTMLElement | null;
        const readerSelection = readerContent
          ? getReaderSelectionDetails(range, readerContent)
          : null;

        setExplanation('');
        setExplanationError('');
        setExplanationLoading(false);
        explanationRequestIdRef.current += 1;
        setPopup({
          phrase: text.slice(0, 500),
          context: readerSelection?.context ?? null,
          rect,
        });
      });
    };

    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('touchend', handleSelection);
    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('touchend', handleSelection);
    };
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
        runtimeLog.error('Phrase translation failed:', err);
        setError(true);
        setLoading(false);
      });
  }, [popup, targetLang, nativeLang]);

  const requestExplanation = async () => {
    if (!popup?.context || !targetLang) return;
    const requestPopup = popup;
    const requestContext = popup.context;
    const id = ++explanationRequestIdRef.current;
    setExplanationLoading(true);
    setExplanationError('');
    try {
      const result = await explainSelection(
        requestPopup.phrase,
        requestContext,
        nativeLang,
        targetLang,
      );
      if (id !== explanationRequestIdRef.current) return;
      setExplanation(result.explanation);
      setExplanationLoading(false);
    } catch (err) {
      if (id !== explanationRequestIdRef.current) return;
      setExplanationError(err instanceof Error ? err.message : 'Explanation failed');
      setExplanationLoading(false);
    }
  };

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
      {popup.context && (
        <>
          <button
            type="button"
            className="phrase-popup-explain"
            disabled={explanationLoading}
            onClick={() => void requestExplanation()}
          >
            {explanationLoading ? 'Asking Gemini…' : 'Explain in context'}
          </button>
          {explanation && (
            <div className="phrase-popup-explanation">{explanation}</div>
          )}
          {explanationError && (
            <div className="phrase-popup-explanation-error">
              <span>{explanationError}</span>
              <button type="button" onClick={() => void requestExplanation()}>Try again</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
