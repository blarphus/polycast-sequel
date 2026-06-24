// ---------------------------------------------------------------------------
// components/WordPopup.tsx — thin React wrapper around the shared, framework-
// agnostic popup core (extension/shared/wordPopupCore.js). The same core powers
// the browser extension's subtitle popup, so the two can't drift. This wrapper
// only injects the web app's I/O (api client) and save/dedup logic.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { lookupWord, enrichWord, explainWord, type SaveWordData } from '../api';
import { playAiSpeech } from '../utils/aiSpeech';
import { useDictionaryToast } from '../hooks/useDictionaryToast';
import { useClickOutside } from '../hooks/useClickOutside';
import '@popup/wordPopup.css';
import '@popup/wordPopupCore.js'; // side-effect: sets window.PolycastWordPopup

type LookupResult = Awaited<ReturnType<typeof lookupWord>>;
type SavedState = 'saved' | 'new-sense' | 'unsaved';

interface WordPopupHandlers {
  lookup: () => Promise<LookupResult>;
  explain?: () => Promise<{ explanation: string }>;
  speak?: () => void | Promise<void>;
  save?: (arg: { word: string; sentence: string; lookupResult: LookupResult | null }) => void | Promise<void>;
  remove?: (arg: { word: string; sentence: string; lookupResult: LookupResult | null }) => void | Promise<void>;
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
  onRemoveWord?: (id: string) => Promise<void>;
  onOptimisticSave?: (word: string) => void;
  isNative?: boolean;
  // Wider passage (rolling ~50-word transcript window) for "Explain in context".
  context?: string;
}

export default function WordPopup(props: WordPopupProps) {
  const {
    word, sentence, nativeLang, targetLang, anchorRect, onClose,
    isWordSaved, isDefinitionSaved, onSaveWord, onRemoveWord, onOptimisticSave, isNative, context,
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
      explain: () => explainWord(word, sentence, nativeLang, targetLang, context),
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

    // Pronounce the word with the same TTS the flashcards use (not for the
    // learner's own native-language words).
    if (!isNative) {
      handlers.speak = () => playAiSpeech(word, targetLang || undefined);
    }

    if (onSaveWord) {
      handlers.save = ({ lookupResult }) => {
        const res = lookupResult;
        const targetWord = res?.target_word || word;
        const lemma = res?.lemma ?? null;
        const senseIndex = res?.sense_index ?? null;
        // Highlight the exact token the learner clicked immediately. Enrichment
        // may take time to return the full list of inflected forms.
        onOptimisticSave?.(word);
        const normalizedWord = lemma || targetWord;
        if (normalizedWord.toLowerCase() !== word.toLowerCase()) {
          onOptimisticSave?.(normalizedWord);
        }
        queueSave(normalizedWord, async () => {
          const enriched = await enrichWord(
            lemma || targetWord,
            sentence,
            nativeLang,
            targetLang,
            lemma && lemma.toLowerCase() !== targetWord.toLowerCase() ? null : senseIndex,
          );
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
            sentence_translation: enriched.sentence_translation,
            part_of_speech: enriched.part_of_speech,
            image_url: enriched.image_url,
            lemma: enriched.lemma || lemma || null,
            forms: enriched.forms || null,
            image_term: enriched.image_term,
          });
        });
      };
    }

    if (onRemoveWord) {
      handlers.remove = async ({ lookupResult }) => {
        const savedWordId = lookupResult?.saved_word_id;
        if (!savedWordId) throw new Error('This word is not linked to a saved dictionary entry yet.');
        await onRemoveWord(savedWordId);
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
  }, [word, sentence, nativeLang, targetLang, context]);

  return null;
}
