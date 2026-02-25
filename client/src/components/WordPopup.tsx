// ---------------------------------------------------------------------------
// components/WordPopup.tsx -- Gemini-powered word translation + definition popup
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { lookupWord, enrichWord, type SaveWordData } from '../api';

interface WordPopupProps {
  word: string;
  sentence: string;
  nativeLang: string;
  targetLang?: string;
  anchorRect: DOMRect;
  onClose: () => void;
  isWordSaved?: boolean;
  onSaveWord?: (data: SaveWordData) => void;
}

export default function WordPopup({ word, sentence, nativeLang, targetLang, anchorRect, onClose, isWordSaved: initialSaved, onSaveWord }: WordPopupProps) {
  const [loading, setLoading] = useState(true);
  const [translation, setTranslation] = useState('');
  const [definition, setDefinition] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(initialSaved ?? false);
  const [saving, setSaving] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;
    lookupWord(word, sentence, nativeLang, targetLang)
      .then((res) => {
        if (!cancelled) {
          setTranslation(res.translation);
          setDefinition(res.definition);
          setPartOfSpeech(res.part_of_speech);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('WordPopup: lookup failed:', err);
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [word, sentence, nativeLang, targetLang]);

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
        <div className="word-popup-header-actions">
          {!loading && !error && onSaveWord && (
            <button
              className={`word-popup-save${saved ? ' saved' : ''}${saving ? ' saving' : ''}`}
              disabled={saving}
              onClick={async () => {
                if (saved || saving) return;
                setSaving(true);
                try {
                  const enriched = await enrichWord(word, sentence, nativeLang, targetLang);
                  onSaveWord({
                    word,
                    translation: enriched.translation,
                    definition: enriched.definition,
                    target_language: targetLang,
                    sentence_context: sentence,
                    frequency: enriched.frequency,
                    example_sentence: enriched.example_sentence,
                    part_of_speech: enriched.part_of_speech,
                  });
                  setSaved(true);
                } catch (err) {
                  console.error('WordPopup: enrichment failed:', err);
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saved ? '\u2713' : saving ? '...' : '+'}
            </button>
          )}
          <button className="word-popup-close" onClick={onClose}>&times;</button>
        </div>
      </div>
      <div className="word-popup-body">
        {loading && (
          <div className="word-popup-loading">
            <div className="loading-spinner" style={{ width: 24, height: 24 }} />
          </div>
        )}
        {!loading && error && <p className="word-popup-error">{error}</p>}
        {!loading && !error && (
          <>
            <p className="word-popup-translation">{translation}</p>
            {partOfSpeech && <span className="word-popup-pos">{partOfSpeech}</span>}
            {definition && <p className="word-popup-definition">{definition}</p>}
          </>
        )}
      </div>
    </div>
  );
}
