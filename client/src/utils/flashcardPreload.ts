import { getDueWords, type SavedWord } from '../api';
import { emitFallbackDiagnostic } from './fallbackDiagnostics';
import { preloadAiSpeech, preloadCardAudio, type PreloadedSpeech } from './aiSpeech';
import { cardSpeechTexts } from './flashcardSpeech';
import { createScopedRuntimeLogger } from './scopedRuntimeLogger';

const runtimeLog = createScopedRuntimeLogger('web.flashcards.preload');
const CARD_CACHE_TTL_MS = 2 * 60 * 1000;
const LOOKAHEAD_CARDS = 8;
const PRELOAD_CONCURRENCY = 4;
const MAX_SPEECH_CACHE_ENTRIES = 32;

let scopedUserId: string | null = null;
let cachedCards: SavedWord[] | null = null;
let cachedAt = 0;
let cardsRequest: Promise<SavedWord[]> | null = null;
let preloadFailureReported = false;
let scopeVersion = 0;
const speechCache = new Map<string, PreloadedSpeech>();
const speechRequests = new Map<string, Promise<PreloadedSpeech>>();

function speechKey(card: SavedWord, text: string) {
  return `${card.id}\u0000${card.target_language || ''}\u0000${text}`;
}

function revokeSpeechCache() {
  for (const speech of speechCache.values()) {
    if (speech.url) URL.revokeObjectURL(speech.url);
  }
  speechCache.clear();
  speechRequests.clear();
}

function useUserScope(userId: string) {
  if (scopedUserId === userId) return;
  scopeVersion += 1;
  revokeSpeechCache();
  scopedUserId = userId;
  cachedCards = null;
  cachedAt = 0;
  cardsRequest = null;
  preloadFailureReported = false;
}

function reportPreloadFallback(error: unknown) {
  runtimeLog.error('Background flashcard preload failed:', error);
  if (preloadFailureReported) return;
  preloadFailureReported = true;
  emitFallbackDiagnostic({
    code: 'flashcard_background_preload_fallback',
    severity: 'warning',
    title: 'Background flashcard preload unavailable',
    message: 'Polycast could not prepare some upcoming flashcards in the background, so they will load when opened.',
    detail: error instanceof Error ? error.message : String(error),
  }, { source: 'web.flashcards', operation: 'background-preload' });
}

export function resetFlashcardPreload() {
  scopeVersion += 1;
  revokeSpeechCache();
  scopedUserId = null;
  cachedCards = null;
  cachedAt = 0;
  cardsRequest = null;
  preloadFailureReported = false;
}

export function invalidateFlashcardCards() {
  cachedCards = null;
  cachedAt = 0;
  cardsRequest = null;
}

export function invalidateFlashcardSpeech(cardId: string) {
  for (const [key, speech] of speechCache.entries()) {
    if (!key.startsWith(`${cardId}\u0000`)) continue;
    if (speech.url) URL.revokeObjectURL(speech.url);
    speechCache.delete(key);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('polycast:dictionary-mutated', (event) => {
    invalidateFlashcardCards();
    const detail = (event as CustomEvent<{ cardId?: string; invalidateSpeech?: boolean }>).detail;
    if (detail?.cardId && detail.invalidateSpeech) invalidateFlashcardSpeech(detail.cardId);
  });
}

export function ensureFlashcardSpeech(card: SavedWord, text: string) {
  const key = speechKey(card, text);
  const ready = speechCache.get(key);
  if (ready) {
    speechCache.delete(key);
    speechCache.set(key, ready);
    return Promise.resolve(ready);
  }

  const pending = speechRequests.get(key);
  if (pending) return pending;

  const requestScope = scopeVersion;
  const request = (text === card.word
    ? preloadCardAudio(card.id)
    : preloadAiSpeech(text, card.target_language || undefined))
    .then((speech) => {
      if (requestScope === scopeVersion) {
        speechCache.set(key, speech);
        while (speechCache.size > MAX_SPEECH_CACHE_ENTRIES) {
          const oldestKey = speechCache.keys().next().value as string | undefined;
          if (!oldestKey) break;
          const oldest = speechCache.get(oldestKey);
          if (oldest?.url) URL.revokeObjectURL(oldest.url);
          speechCache.delete(oldestKey);
        }
      } else if (speech.url) URL.revokeObjectURL(speech.url);
      return speech;
    })
    .finally(() => {
      if (speechRequests.get(key) === request) speechRequests.delete(key);
    });
  speechRequests.set(key, request);
  return request;
}

export async function getPrefetchedFlashcards(userId: string) {
  useUserScope(userId);
  if (cachedCards && Date.now() - cachedAt < CARD_CACHE_TTL_MS) return cachedCards;
  if (cardsRequest) return cardsRequest;

  const requestScope = scopeVersion;
  const request = getDueWords()
    .then((cards) => {
      if (requestScope === scopeVersion) {
        cachedCards = cards;
        cachedAt = Date.now();
      }
      return cards;
    })
    .finally(() => {
      if (cardsRequest === request) cardsRequest = null;
    });
  cardsRequest = request;
  return cardsRequest;
}

export async function warmFlashcardAudio(
  cards: SavedWord[],
  startIndex = 0,
  awaitFirstCard = false,
) {
  const warmScope = scopeVersion;
  const lookahead = cards.slice(startIndex, startIndex + LOOKAHEAD_CARDS);
  if (lookahead.length === 0) return;

  const firstRequests = cardSpeechTexts(lookahead[0])
    .map((text) => ensureFlashcardSpeech(lookahead[0], text));
  if (awaitFirstCard) {
    await Promise.all(firstRequests).catch(reportPreloadFallback);
  }

  const queue = lookahead.flatMap((card) => (
    cardSpeechTexts(card).map((text) => ({ card, text }))
  ));
  let next = 0;
  const worker = async () => {
    while (warmScope === scopeVersion && next < queue.length) {
      const item = queue[next++];
      try {
        await ensureFlashcardSpeech(item.card, item.text);
      } catch (error) {
        reportPreloadFallback(error);
      }
    }
  };
  for (let index = 0; index < Math.min(PRELOAD_CONCURRENCY, queue.length); index += 1) {
    void worker();
  }
}

export async function prefetchFlashcards(userId: string) {
  useUserScope(userId);
  const requestScope = scopeVersion;
  const cards = await getPrefetchedFlashcards(userId);
  if (requestScope === scopeVersion) void warmFlashcardAudio(cards);
  return cards;
}

export async function prepareFlashcardsForStudy(userId: string) {
  useUserScope(userId);
  const requestScope = scopeVersion;
  const cards = await getPrefetchedFlashcards(userId);
  if (requestScope === scopeVersion) await warmFlashcardAudio(cards, 0, true);
  return cards;
}
