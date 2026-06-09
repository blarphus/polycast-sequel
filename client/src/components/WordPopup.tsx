// ---------------------------------------------------------------------------
// components/WordPopup.tsx — thin React wrapper around the shared, framework-
// agnostic popup core (extension/shared/wordPopupCore.js). The same core powers
// the browser extension's subtitle popup, so the two can't drift. This wrapper
// only injects the web app's I/O (api client) and save/dedup logic.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { lookupWord, enrichWord, explainWord, type SaveWordData } from '../api';
import { useDictionaryToast } from '../hooks/useDictionaryToast';
import { useClickOutside } from '../hooks/useClickOutside';
import '@popup/wordPopup.css';
import '@popup/wordPopupCore.js'; // side-effect: sets window.PolycastWordPopup

type LookupResult = Awaited<ReturnType<typeof lookupWord>>;
type SavedState = 'saved' | 'new-sense' | 'unsaved';

interface WordPopupHandlers {
  lookup: () => Promise<LookupResult>;
  explain?: () => Promise<{ explanation: string }>;
  save?: (arg: { word: string; sentence: string; lookupResult: LookupResult | null }) => void | Promise<void>;
  resolveSavedState?: (res: LookupResult) => SavedState;
}

interface CreateWordPopupOptions {
  word: string;
  sentence: string;
  anchorRect: DOMRect;
  container?: HTMLElement;
  onClose?: () => void;
  initialSavedHint?: boolean;
  nativeMode?: boolean;
  handlers: WordPopupHandlers;
}

declare global {
  interface Window {
    PolycastWordPopup?: {
      createWordPopup(opts: CreateWordPopupOptions): { el: HTMLElement; destroy(): void };
    };
  }
}

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
  onOptimisticSave?: (word: string) => void;
  isNative?: boolean;
}

export default function WordPopup(props: WordPopupProps) {
  const {
    word, sentence, nativeLang, targetLang, anchorRect, onClose,
    isWordSaved, isDefinitionSaved, onSaveWord, onOptimisticSave, isNative,
  } = props;
  const { queueSave } = useDictionaryToast();
  const elRef = useRef<HTMLElement | null>(null);

  useClickOutside(elRef, onClose);

  useEffect(() => {
    const core = window.PolycastWordPopup;
    if (!core) {
      console.error('WordPopup: shared popup core (window.PolycastWordPopup) not loaded');
      return;
    }

    const handlers: WordPopupHandlers = {
      lookup: () => lookupWord(word, sentence, nativeLang, targetLang, isNative),
      explain: () => explainWord(word, sentence, nativeLang, targetLang),
      resolveSavedState: (res) => {
        // Use the matched Wiktionary gloss for dedup when available — it matches
        // saved definitions reliably; key on the lemma/target word.
        const defForDedup = res.matched_gloss ?? res.definition;
        const dedupWord = res.lemma || res.target_word || word;
        if (isDefinitionSaved?.(dedupWord, defForDedup)) return 'saved';
        if (isWordSaved?.(dedupWord)) return 'new-sense';
        return 'unsaved';
      },
    };

    if (onSaveWord) {
      handlers.save = ({ lookupResult }) => {
        const res = lookupResult;
        const targetWord = res?.target_word || word;
        const lemma = res?.lemma ?? null;
        const senseIndex = res?.sense_index ?? null;
        onOptimisticSave?.(lemma || targetWord);
        queueSave(lemma || targetWord, async () => {
          const enriched = await enrichWord(targetWord, sentence, nativeLang, targetLang, senseIndex);
          const savedWord = enriched.lemma || lemma || targetWord;
          await onSaveWord({
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
            image_term: enriched.image_term,
          });
        });
      };
    }

    const controls = core.createWordPopup({
      word,
      sentence,
      anchorRect,
      container: document.body,
      onClose,
      nativeMode: !!isNative,
      initialSavedHint: isWordSaved?.(word) ?? false,
      handlers,
    });
    elRef.current = controls.el;

    return () => {
      controls.destroy();
      elRef.current = null;
    };
    // Re-mount the popup only when the looked-up word/context changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, sentence, nativeLang, targetLang]);

  return null;
}
