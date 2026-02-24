// ---------------------------------------------------------------------------
// components/WordPopup.tsx -- Gemini-powered word explanation popup
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { lookupWord } from '../api';

interface WordPopupProps {
  word: string;
  sentence: string;
  targetLang?: string;
  anchorRect: DOMRect;
  onClose: () => void;
}

export default function WordPopup({ word, sentence, targetLang, anchorRect, onClose }: WordPopupProps) {
  const [loading, setLoading] = useState(true);
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState('');
  const popupRef = useRef<HTMLDivElement>(null);

  // Fetch explanation on mount
  useEffect(() => {
    let cancelled = false;
    lookupWord(word, sentence, targetLang)
      .then((res) => {
        if (!cancelled) {
          setExplanation(res.explanation);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Lookup failed');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [word, sentence, targetLang]);

  // Click-outside to dismiss
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  // Position: centered above the clicked word, flip below if off-screen top
  const popupWidth = 300;
  let left = anchorRect.left + anchorRect.width / 2 - popupWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));

  let top = anchorRect.top - 8;
  let transformOrigin = 'bottom center';
  const flipBelow = top < 120;
  if (flipBelow) {
    top = anchorRect.bottom + 8;
    transformOrigin = 'top center';
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    left,
    top: flipBelow ? top : undefined,
    bottom: flipBelow ? undefined : window.innerHeight - top,
    width: popupWidth,
    zIndex: 30,
    transformOrigin,
  };

  return (
    <div className="word-popup" ref={popupRef} style={style}>
      <div className="word-popup-header">
        <span className="word-popup-word">{word}</span>
        <button className="word-popup-close" onClick={onClose}>&times;</button>
      </div>
      <div className="word-popup-body">
        {loading && (
          <div className="word-popup-loading">
            <div className="loading-spinner" style={{ width: 24, height: 24 }} />
          </div>
        )}
        {!loading && error && <p className="word-popup-error">{error}</p>}
        {!loading && !error && <p className="word-popup-text">{explanation}</p>}
      </div>
    </div>
  );
}
