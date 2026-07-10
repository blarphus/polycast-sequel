// ---------------------------------------------------------------------------
// components/WordPopup.tsx — thin React wrapper around the shared, framework-
// agnostic popup core (extension/shared/wordPopupCore.js). The same core powers
// the browser extension's subtitle popup, so the two can't drift. This wrapper
// only injects the web app's I/O (api client) and save/dedup logic.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { lookupWord, enrichWord, explainWord, getStudentDashboard, type SaveWordData } from '../api';
import { playAiSpeech } from '../utils/aiSpeech';
import { useDictionaryToast } from '../hooks/useDictionaryToast';
import { useClickOutside } from '../hooks/useClickOutside';
import '@popup/wordPopup.css';
import '@popup/wordPopupCore.js'; // side-effect: sets window.PolycastWordPopup
import {
  DAILY_GOAL_EVENT,
  getDailyGoalSnapshot,
  seedDailyWordProgress,
  type DailyGoalSnapshot,
} from '../utils/dailyGoal';

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
  languageName?: string | null;
  handlers: WordPopupHandlers;
}

declare global {
  interface Window {
    PolycastWordPopup?: {
      createWordPopup(opts: CreateWordPopupOptions): { el: HTMLElement; destroy(): void };
      setFlameLevel(flameEl: Element | null, ratio: number, opts?: { burst?: boolean }): void;
      FLAME_SVG: string;
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
            {
              definition: res?.definition || res?.matched_gloss || null,
              part_of_speech: res?.part_of_speech || null,
              definition_source: res?.definition_source || null,
              matched_gloss: res?.matched_gloss || null,
            },
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
            shared_entry_id: enriched.shared_entry_id || null,
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
      languageName: targetLang
        ? new Intl.DisplayNames(['en'], { type: 'language' }).of(targetLang) || targetLang.toUpperCase()
        : null,
      handlers,
    });
    elRef.current = controls.el;

    const goalEl = document.createElement('div');
    goalEl.className = 'pc-popup-goal';
    const renderGoal = (snapshot: DailyGoalSnapshot, animate = false) => {
      goalEl.classList.toggle('pc-popup-goal--complete', snapshot.complete);
      const stepCount = Math.min(snapshot.goal, 10);
      const filledSteps = Math.round((Math.min(snapshot.added, snapshot.goal) / snapshot.goal) * stepCount);
      const steps = Array.from({ length: stepCount }, (_, index) =>
        `<i class="${index < filledSteps ? 'pc-popup-goal-step--filled' : ''}"></i>`).join('');
      const label = snapshot.complete ? 'Goal complete' : `${snapshot.remaining} more today`;
      goalEl.innerHTML = `
        <span class="pc-popup-goal-flame" aria-label="${snapshot.added} of ${snapshot.goal} daily words">${core.FLAME_SVG}</span>
        <div class="pc-popup-goal-steps">${steps}</div>
        <strong>${snapshot.added} of ${snapshot.goal}</strong><span class="pc-popup-goal-divider"></span><span>${label}</span>`;
      core.setFlameLevel(
        goalEl.querySelector('.pc-popup-goal-flame'),
        Math.min(1, snapshot.added / snapshot.goal),
        { burst: animate },
      );
    };
    renderGoal(getDailyGoalSnapshot());
    controls.el.querySelector('.pc-popup-explain')?.before(goalEl);
    const onGoalChange = (event: Event) => {
      const detail = (event as CustomEvent<DailyGoalSnapshot & { justAdded?: boolean }>).detail;
      if (detail) renderGoal(detail, !!detail.justAdded);
    };
    window.addEventListener(DAILY_GOAL_EVENT, onGoalChange);
    getStudentDashboard()
      .then((dashboard) => seedDailyWordProgress(dashboard.wordsAddedToday))
      .catch(() => undefined);

    return () => {
      window.removeEventListener(DAILY_GOAL_EVENT, onGoalChange);
      controls.destroy();
      elRef.current = null;
    };
    // Re-mount the popup only when the looked-up word/context changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, sentence, nativeLang, targetLang, context]);

  return null;
}
