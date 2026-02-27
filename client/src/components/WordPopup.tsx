import React, { useEffect, useRef, useState } from 'react';
import { lookupWord, enrichWord, type SaveWordData } from '../api';
import { useDictionaryToast } from '../hooks/useDictionaryToast';

interface WordPopupProps {
  word: string;
  sentence: string;
  nativeLang: string;
  targetLang?: string;
  anchorRect: DOMRect;
  onClose: () => void;
  isWordSaved?: (word: string) => boolean;
  isDefinitionSaved?: (word: string, definition: string) => boolean;
  onSaveWord?: (data: SaveWordData) => Promise<{ _created: boolean }>;
}

export default function WordPopup({ word, sentence, nativeLang, targetLang, anchorRect, onClose, isWordSaved, isDefinitionSaved, onSaveWord }: WordPopupProps) {
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(true);
  const [translation, setTranslation] = useState('');
  const [definition, setDefinition] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [newDefinition, setNewDefinition] = useState(false);
  const [senseIndex, setSenseIndex] = useState<number | null>(null);
  const [matchedGloss, setMatchedGloss] = useState<string | null>(null);
  const [lemma, setLemma] = useState<string | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const { queueSave } = useDictionaryToast();

  useEffect(() => {
    let cancelled = false;

    lookupWord(word, sentence, nativeLang, targetLang)
      .then((res) => {
        if (!cancelled) {
          setValid(res.valid);
          setTranslation(res.translation);
          setDefinition(res.definition);
          setPartOfSpeech(res.part_of_speech);
          setSenseIndex(res.sense_index);
          setMatchedGloss(res.matched_gloss);
          setLemma(res.lemma);
          // Use matched_gloss (Wikt gloss) for dedup when available — it matches saved definitions reliably
          const defForDedup = res.matched_gloss ?? res.definition;
          const dedupWord = res.lemma || word;
          if (isDefinitionSaved?.(dedupWord, defForDedup)) {
            setSaved(true);
          } else if (isWordSaved?.(dedupWord)) {
            setNewDefinition(true);
          }
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

  const handleSave = () => {
    if (saved) return;
    setSaved(true);
    queueSave(lemma || word, async () => {
      const enriched = await enrichWord(word, sentence, nativeLang, targetLang, senseIndex);
      const savedWord = enriched.lemma || lemma || word;
      await onSaveWord!({
        word: savedWord,
        translation: enriched.translation,
        definition: enriched.definition,
        target_language: targetLang,
        sentence_context: sentence,
        frequency: enriched.frequency,
        frequency_count: enriched.frequency_count,
        example_sentence: enriched.example_sentence,
        part_of_speech: enriched.part_of_speech,
        image_url: enriched.image_url,
        lemma: enriched.lemma || lemma || null,
        forms: enriched.forms || null,
      });
    });
  };

  return (
    <div className="word-popup" ref={popupRef} style={style}>
      <div className="word-popup-header">
        <span className="word-popup-word">{word}</span>
        {onSaveWord && (
          <button
            className={`word-popup-save${saved ? ' saved' : ''}`}
            disabled={saved || loading}
            onClick={handleSave}
          >
            {saved ? (duplicate ? '✓ Already saved' : '✓ Added') : 'Add'}
          </button>
        )}
        <button className="word-popup-close" onClick={onClose}>&times;</button>
      </div>
      <div className="word-popup-body">
        {loading ? (
          <div className="word-popup-loading">
            <div className="loading-spinner" style={{ width: 24, height: 24 }} />
          </div>
        ) : error ? (
          <p className="word-popup-error">{error}</p>
        ) : !valid ? (
          <p className="word-popup-invalid">Not a word</p>
        ) : (
          <>
            <div className="word-popup-translation-row">
              <p className="word-popup-translation">{translation}</p>
              {newDefinition && !saved && <span className="word-popup-new-def-pill">New definition!</span>}
            </div>
            {partOfSpeech && <span className="word-popup-pos">{partOfSpeech}</span>}
            {definition && <p className="word-popup-definition">{definition}</p>}
          </>
        )}
      </div>
    </div>
  );
}
