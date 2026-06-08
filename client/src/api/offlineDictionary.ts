import { buildDictionaryGroups, getDueNextGroupKeys, isDictionaryEntryNew } from '../utils/dictionaryGroups';
import type { AuthSession, AuthUser } from './auth';
import type {
  DictionarySortMode,
  SavedWord,
  SaveWordData,
  SrsAnswer,
} from './dictionary';

const OFFLINE_ENABLED_KEY = 'polycast.offline.enabled';
const OFFLINE_USER_KEY = 'polycast.offline.user.v1';
const OFFLINE_WORDS_KEY = 'polycast.offline.dictionary.words.v1';
const OFFLINE_DICTIONARY_SYNC_EVENT = 'polycast-offline-dictionary-external-sync';

const LEARNING_STEPS = [60, 600];
const GRADUATING_INTERVAL = 86400;
const EASY_GRADUATING_INTERVAL = 345600;
const RELEARNING_STEP = 600;
const MIN_EASE = 1.3;
const LAPSE_INTERVAL_FACTOR = 0.1;
const MIN_REVIEW_INTERVAL = 86400;

type LocalResult = { handled: true; data: unknown } | { handled: false };

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function isOfflineModeEnabled(): boolean {
  return canUseStorage() && window.localStorage.getItem(OFFLINE_ENABLED_KEY) === 'true';
}

function markOfflineEnabled() {
  if (canUseStorage()) window.localStorage.setItem(OFFLINE_ENABLED_KEY, 'true');
}

function uuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOfflineUser(): AuthSession {
  if (!canUseStorage()) {
    return {
      id: 'offline-local-user',
      username: 'offline',
      display_name: 'Offline Mode',
      native_language: 'en',
      target_language: 'es',
      daily_new_limit: 20,
      account_type: 'student',
      cefr_level: null,
      token: 'offline-local-token',
    };
  }

  const raw = window.localStorage.getItem(OFFLINE_USER_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // Fall through and replace malformed data.
    }
  }

  const user: AuthSession = {
    id: 'offline-local-user',
    username: 'offline',
    display_name: 'Offline Mode',
    native_language: 'en',
    target_language: 'es',
    daily_new_limit: 20,
    account_type: 'student',
    cefr_level: null,
    token: 'offline-local-token',
  };
  window.localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify(user));
  return user;
}

function saveOfflineUser(user: AuthSession | AuthUser) {
  if (!canUseStorage()) return;
  const current = getOfflineUser();
  window.localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify({ ...current, ...user, token: current.token }));
}

function readWords(): SavedWord[] {
  if (!canUseStorage()) return [];
  const raw = window.localStorage.getItem(OFFLINE_WORDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeWords(words: SavedWord[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(OFFLINE_WORDS_KEY, JSON.stringify(words));
  window.dispatchEvent(new CustomEvent(OFFLINE_DICTIONARY_SYNC_EVENT, { detail: { words } }));
}

function basicDefinition(word: string, sentence?: string | null) {
  const context = sentence?.trim();
  return context ? `Saved offline from: ${context}` : `Saved offline. Add a definition when the server is available.`;
}

function toSavedWord(data: SaveWordData): SavedWord {
  const now = new Date().toISOString();
  const user = getOfflineUser();
  return {
    id: uuid(),
    word: data.word,
    translation: data.translation || '',
    definition: data.definition || basicDefinition(data.word, data.sentence_context),
    target_language: data.target_language || user.target_language || null,
    sentence_context: data.sentence_context || null,
    created_at: now,
    frequency: data.frequency ?? null,
    frequency_count: data.frequency_count ?? null,
    example_sentence: data.example_sentence || data.sentence_context || null,
    sentence_translation: data.sentence_translation || null,
    part_of_speech: data.part_of_speech || null,
    srs_interval: 0,
    due_at: null,
    last_reviewed_at: null,
    correct_count: 0,
    incorrect_count: 0,
    ease_factor: 2.5,
    learning_step: null,
    image_url: data.image_url || null,
    lemma: data.lemma || null,
    forms: data.forms || null,
    prompt_stage: 0,
    priority: false,
    image_term: data.image_term || null,
    queue_position: null,
    introduced_date: null,
  };
}

function computeNextReview(card: SavedWord, answer: SrsAnswer) {
  const inLearning = card.learning_step !== null || card.srs_interval === 0;
  const isRelearning = card.learning_step !== null && card.srs_interval > 0;
  let newInterval = card.srs_interval;
  let newEase = card.ease_factor;
  let newStep = card.learning_step;
  let dueSeconds = GRADUATING_INTERVAL;

  if (inLearning) {
    const step = card.learning_step ?? 0;
    if (answer === 'again') {
      newStep = 0;
      dueSeconds = LEARNING_STEPS[0];
    } else if (answer === 'hard') {
      newStep = step;
      dueSeconds = step === 0 ? 360 : LEARNING_STEPS[1];
    } else if (answer === 'good') {
      if (step >= LEARNING_STEPS.length - 1) {
        newStep = null;
        if (isRelearning) {
          dueSeconds = card.srs_interval;
        } else {
          newInterval = GRADUATING_INTERVAL;
          dueSeconds = GRADUATING_INTERVAL;
        }
      } else {
        newStep = step + 1;
        dueSeconds = LEARNING_STEPS[step + 1];
      }
    } else {
      newStep = null;
      newInterval = EASY_GRADUATING_INTERVAL;
      newEase = Math.max(newEase + 0.15, MIN_EASE);
      dueSeconds = EASY_GRADUATING_INTERVAL;
    }
  } else if (answer === 'again') {
    newEase = Math.max(newEase - 0.20, MIN_EASE);
    newInterval = Math.max(Math.round(card.srs_interval * LAPSE_INTERVAL_FACTOR), MIN_REVIEW_INTERVAL);
    newStep = 0;
    dueSeconds = RELEARNING_STEP;
  } else if (answer === 'hard') {
    newEase = Math.max(newEase - 0.15, MIN_EASE);
    newInterval = Math.max(Math.round(card.srs_interval * 1.2), MIN_REVIEW_INTERVAL);
    dueSeconds = newInterval;
  } else if (answer === 'good') {
    newInterval = Math.max(Math.round(card.srs_interval * newEase), MIN_REVIEW_INTERVAL);
    dueSeconds = newInterval;
  } else {
    newEase = Math.max(newEase + 0.15, MIN_EASE);
    newInterval = Math.max(Math.round(card.srs_interval * newEase * 1.3), MIN_REVIEW_INTERVAL);
    dueSeconds = newInterval;
  }

  return { newInterval, newEase, newStep, dueSeconds };
}

function reviewLocalWord(id: string, answer: SrsAnswer): SavedWord | null {
  const words = readWords();
  const index = words.findIndex((word) => word.id === id);
  if (index === -1) return null;

  const card = words[index];
  const next = computeNextReview(card, answer);
  const now = new Date();
  const currentStage = card.prompt_stage ?? 0;
  const promptStage = answer === 'again'
    ? (card.learning_step === 0 ? Math.max(currentStage - 1, 0) : currentStage)
    : answer === 'hard'
      ? currentStage
      : Math.min(currentStage + 1, 4);

  const updated: SavedWord = {
    ...card,
    srs_interval: next.newInterval,
    ease_factor: next.newEase,
    learning_step: next.newStep,
    due_at: new Date(now.getTime() + next.dueSeconds * 1000).toISOString(),
    last_reviewed_at: now.toISOString(),
    correct_count: card.correct_count + (answer === 'again' ? 0 : 1),
    incorrect_count: card.incorrect_count + (answer === 'again' ? 1 : 0),
    prompt_stage: promptStage,
    introduced_date: card.introduced_date || now.toISOString().slice(0, 10),
  };

  words[index] = updated;
  writeWords(words);
  return updated;
}

function dueWords(): SavedWord[] {
  const now = Date.now();
  return readWords()
    .filter((word) => isDictionaryEntryNew(word) || !word.due_at || new Date(word.due_at).getTime() <= now)
    .sort((a, b) => {
      const aNew = isDictionaryEntryNew(a);
      const bNew = isDictionaryEntryNew(b);
      if (aNew !== bNew) return aNew ? -1 : 1;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
}

function dictionaryGroups(searchParams: URLSearchParams) {
  const page = Math.max(0, Number(searchParams.get('page') || 0));
  const limit = Math.max(1, Number(searchParams.get('limit') || 20));
  const search = searchParams.get('search') || '';
  const sort = (searchParams.get('sort') || 'queue') as DictionarySortMode;
  const groups = buildDictionaryGroups(readWords(), search, sort);
  const dueNextGroupKeys = Array.from(getDueNextGroupKeys(groups, getOfflineUser().daily_new_limit || 20));
  const totalGroups = groups.length;
  const totalPages = Math.max(1, Math.ceil(totalGroups / limit));
  const adjustedPage = Math.min(page, totalPages - 1);
  const start = adjustedPage * limit;

  return {
    groups: groups.slice(start, start + limit),
    dueNextGroupKeys,
    page: adjustedPage,
    totalGroups,
    totalPages,
  };
}

function saveWord(data: SaveWordData) {
  const words = readWords();
  const targetLanguage = data.target_language || getOfflineUser().target_language || null;
  const existing = words.find((word) =>
    word.word.toLowerCase() === data.word.toLowerCase() &&
    word.target_language === targetLanguage &&
    word.definition === (data.definition || basicDefinition(data.word, data.sentence_context)));

  if (existing) return { ...existing, _created: false };

  const saved = toSavedWord({ ...data, target_language: targetLanguage || undefined });
  writeWords([saved, ...words]);
  return { ...saved, _created: true };
}

export async function handleOfflineRequest(path: string, method: string, body?: unknown): Promise<LocalResult> {
  if (!canUseStorage()) return { handled: false };

  const url = new URL(path, window.location.origin);
  const normalizedPath = url.pathname;
  const upperMethod = method.toUpperCase();
  const user = getOfflineUser();

  if (normalizedPath === '/me' && upperMethod === 'GET') {
    markOfflineEnabled();
    return { handled: true, data: user };
  }

  if (normalizedPath === '/login' && upperMethod === 'POST') {
    markOfflineEnabled();
    const loginBody = body as { username?: string } | undefined;
    const nextUser = {
      ...user,
      username: loginBody?.username || user.username,
      display_name: loginBody?.username || user.display_name,
    };
    saveOfflineUser(nextUser);
    return { handled: true, data: nextUser };
  }

  if (normalizedPath === '/signup' && upperMethod === 'POST') {
    markOfflineEnabled();
    const signupBody = body as { username?: string; display_name?: string } | undefined;
    const nextUser = {
      ...user,
      username: signupBody?.username || user.username,
      display_name: signupBody?.display_name || signupBody?.username || user.display_name,
    };
    saveOfflineUser(nextUser);
    return { handled: true, data: nextUser };
  }

  if (normalizedPath === '/session/restore' && upperMethod === 'POST') {
    markOfflineEnabled();
    return { handled: true, data: user };
  }

  if (normalizedPath === '/session/export' && upperMethod === 'POST') {
    markOfflineEnabled();
    return { handled: true, data: { token: user.token } };
  }

  if (normalizedPath === '/logout' && upperMethod === 'POST') {
    return { handled: true, data: undefined };
  }

  if (normalizedPath === '/me/settings' && upperMethod === 'PATCH') {
    const settings = body as Partial<AuthUser>;
    const nextUser = { ...user, ...settings };
    saveOfflineUser(nextUser);
    return { handled: true, data: nextUser };
  }

  if (normalizedPath === '/dictionary/words' && upperMethod === 'GET') {
    markOfflineEnabled();
    return { handled: true, data: readWords() };
  }

  if (normalizedPath === '/dictionary/words' && upperMethod === 'POST') {
    markOfflineEnabled();
    return { handled: true, data: saveWord(body as SaveWordData) };
  }

  if (normalizedPath === '/dictionary/due' && upperMethod === 'GET') {
    markOfflineEnabled();
    return { handled: true, data: dueWords() };
  }

  if (normalizedPath === '/dictionary/new-today' && upperMethod === 'GET') {
    markOfflineEnabled();
    return { handled: true, data: readWords().filter(isDictionaryEntryNew) };
  }

  if (normalizedPath === '/dictionary/word-groups' && upperMethod === 'GET') {
    markOfflineEnabled();
    return { handled: true, data: dictionaryGroups(url.searchParams) };
  }

  if (normalizedPath === '/home/student-dashboard' && upperMethod === 'GET') {
    markOfflineEnabled();
    return {
      handled: true,
      data: {
        newToday: readWords().filter(isDictionaryEntryNew),
        dueWords: dueWords(),
        pendingClasswork: { count: 0, posts: [] },
      },
    };
  }

  const reviewMatch = normalizedPath.match(/^\/dictionary\/words\/([^/]+)\/review$/);
  if (reviewMatch && upperMethod === 'PATCH') {
    const reviewed = reviewLocalWord(reviewMatch[1], (body as { answer: SrsAnswer }).answer);
    if (!reviewed) throw new Error('Word not found');
    return { handled: true, data: reviewed };
  }

  const imageMatch = normalizedPath.match(/^\/dictionary\/words\/([^/]+)\/image$/);
  if (imageMatch && upperMethod === 'PATCH') {
    const words = readWords();
    const index = words.findIndex((word) => word.id === imageMatch[1]);
    if (index === -1) throw new Error('Word not found');
    words[index] = { ...words[index], image_url: (body as { image_url?: string }).image_url || null };
    writeWords(words);
    return { handled: true, data: words[index] };
  }

  const deleteMatch = normalizedPath.match(/^\/dictionary\/words\/([^/]+)$/);
  if (deleteMatch && upperMethod === 'DELETE') {
    writeWords(readWords().filter((word) => word.id !== deleteMatch[1]));
    return { handled: true, data: undefined };
  }

  if (normalizedPath === '/dictionary/queue-reorder' && upperMethod === 'PATCH') {
    const updates = (body as { items?: Array<{ id: string; queue_position: number }> }).items || [];
    const updateMap = new Map(updates.map((item) => [item.id, item.queue_position]));
    writeWords(readWords().map((word) => (
      updateMap.has(word.id) ? { ...word, queue_position: updateMap.get(word.id)! } : word
    )));
    return { handled: true, data: undefined };
  }

  return { handled: false };
}

export { OFFLINE_WORDS_KEY, OFFLINE_DICTIONARY_SYNC_EVENT };
