// ---------------------------------------------------------------------------
// components/WordPopup.tsx -- Word translation + definition popup
// Google Translate for fast translation, Gemini for definition/POS/image_term
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { translateWord, lookupWord, enrichWord, type SaveWordData } from '../api';

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
  const [translationLoading, setTranslationLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [translation, setTranslation] = useState('');
  const [definition, setDefinition] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState<string | null>(null);
  const [imageTerm, setImageTerm] = useState('');
  const [translationError, setTranslationError] = useState('');
  const [detailsError, setDetailsError] = useState('');
  const [saved, setSaved] = useState(initialSaved ?? false);
  const [saving, setSaving] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Two parallel fetches on mount
  useEffect(() => {
    let cancelled = false;

    // Fast: Google Translate for the translation
    translateWord(word, targetLang || '', nativeLang)
      .then((res) => {
        if (!cancelled) {
          setTranslation(res.translation);
          setTranslationLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('WordPopup: translation failed:', err);
          setTranslationError(err instanceof Error ? err.message : String(err));
          setTranslationLoading(false);
        }
      });

    // Slower: Gemini for definition, POS, image_term
    lookupWord(word, sentence, nativeLang, targetLang)
      .then((res) => {
        if (!cancelled) {
          setDefinition(res.definition);
          setPartOfSpeech(res.part_of_speech);
          setImageTerm(res.image_term);
          setDetailsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('WordPopup: lookup failed:', err);
          setDetailsError(err instanceof Error ? err.message : String(err));
          setDetailsLoading(false);
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

  const bothDone = !translationLoading && !detailsLoading;
  const hasAnyError = translationError && detailsError;

  return (
    <div className="word-popup" ref={popupRef} style={style}>
      <div className="word-popup-header">
        <span className="word-popup-word">{word}</span>
        <div className="word-popup-header-actions">
          {bothDone && !hasAnyError && onSaveWord && (
            <button
              className={`word-popup-save${saved ? ' saved' : ''}${saving ? ' saving' : ''}`}
              disabled={saving}
              onClick={async () => {
                if (saved || saving) return;
                setSaving(true);
                try {
                  const enriched = await enrichWord(word, sentence, nativeLang, targetLang, imageTerm);
                  onSaveWord({
                    word,
                    translation: enriched.translation,
                    definition: enriched.definition,
                    target_language: targetLang,
                    sentence_context: sentence,
                    frequency: enriched.frequency,
                    example_sentence: enriched.example_sentence,
                    part_of_speech: enriched.part_of_speech,
                    image_url: enriched.image_url,
                  });
                  setSaved(true);
                } catch (err) {
                  console.error('WordPopup: enrichment failed:', err);
                  setDetailsError(err instanceof Error ? err.message : String(err));
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
        {/* Translation section (Google Translate — fast) */}
        {translationLoading ? (
          <div className="word-popup-loading">
            <div className="loading-spinner" style={{ width: 24, height: 24 }} />
          </div>
        ) : translationError ? (
          <p className="word-popup-error">{translationError}</p>
        ) : (
          <p className="word-popup-translation">{translation}</p>
        )}

        {/* Details section (Gemini — slower) */}
        {detailsLoading ? (
          !translationLoading && (
            <div className="word-popup-loading" style={{ padding: '0.4rem 0' }}>
              <div className="loading-spinner" style={{ width: 16, height: 16 }} />
            </div>
          )
        ) : detailsError ? (
          <p className="word-popup-error">{detailsError}</p>
        ) : (
          <>
            {partOfSpeech && <span className="word-popup-pos">{partOfSpeech}</span>}
            {definition && <p className="word-popup-definition">{definition}</p>}
          </>
        )}
      </div>
    </div>
  );
}
