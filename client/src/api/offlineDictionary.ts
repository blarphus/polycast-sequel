import { buildDictionaryGroups, isDictionaryEntryNew } from '../utils/dictionaryGroups';
import { applyAnswerLocally } from '../utils/srs';
import { emitFallbackDiagnostic } from '../utils/fallbackDiagnostics';
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

type LocalResult = { handled: true; data: unknown } | { handled: false };

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
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
      created_at: '1970-01-01T00:00:00.000Z',
      native_language: 'en',
      target_language: 'es',
      daily_new_limit: 20,
      daily_word_goal: 5,
      total_xp: 0,
      account_type: 'student',
      cefr_level: null,
      token: 'offline-local-token',
    };
  }

  const raw = window.localStorage.getItem(OFFLINE_USER_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      emitFallbackDiagnostic({
        code: 'offline_profile_storage_repaired',
        severity: 'warning',
        title: 'Offline profile repaired',
        message: 'Stored offline profile data was malformed, so Polycast replaced it with a safe local profile.',
        detail: error instanceof Error ? error.message : String(error),
      }, { source: 'web.offline-dictionary', operation: 'load-offline-profile' });
    }
  }

  const user: AuthSession = {
    id: 'offline-local-user',
    username: 'offline',
    display_name: 'Offline Mode',
    created_at: '1970-01-01T00:00:00.000Z',
    native_language: 'en',
    target_language: 'es',
    daily_new_limit: 20,
    daily_word_goal: 5,
    total_xp: 0,
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
  } catch (error) {
    emitFallbackDiagnostic({
      code: 'offline_dictionary_storage_repaired',
      severity: 'warning',
      title: 'Offline dictionary repaired',
      message: 'Stored offline words were malformed, so Polycast reset the local dictionary copy.',
      detail: error instanceof Error ? error.message : String(error),
    }, { source: 'web.offline-dictionary', operation: 'read-offline-words' });
    return [];
  }
}

function writeWords(words: SavedWord[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(OFFLINE_WORDS_KEY, JSON.stringify(words));
  window.dispatchEvent(new CustomEvent(OFFLINE_DICTIONARY_SYNC_EVENT, { detail: { words } }));
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateTimeAtStartOfDay(date: Date) {
  return `${localDateKey(date)}T00:00:00`;
}

function compareNewEntries(a: SavedWord, b: SavedWord): number {
  const aQueue = a.queue_position ?? Number.POSITIVE_INFINITY;
  const bQueue = b.queue_position ?? Number.POSITIVE_INFINITY;
  if (aQueue !== bQueue) return aQueue - bQueue;

  const aPriority = a.priority ? 0 : 1;
  const bPriority = b.priority ? 0 : 1;
  if (aPriority !== bPriority) return aPriority - bPriority;

  const aFrequencyCount = a.frequency_count ?? 0;
  const bFrequencyCount = b.frequency_count ?? 0;
  if (aFrequencyCount !== bFrequencyCount) return bFrequencyCount - aFrequencyCount;

  const aFrequency = a.frequency ?? 0;
  const bFrequency = b.frequency ?? 0;
  if (aFrequency !== bFrequency) return bFrequency - aFrequency;

  const createdDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (createdDiff !== 0) return createdDiff;

  return a.id.localeCompare(b.id);
}

function compareNewQueuePosition(a: SavedWord, b: SavedWord): number {
  const aPriority = a.priority ? 0 : 1;
  const bPriority = b.priority ? 0 : 1;
  if (aPriority !== bPriority) return aPriority - bPriority;

  const aFrequencyCount = a.frequency_count ?? 0;
  const bFrequencyCount = b.frequency_count ?? 0;
  if (aFrequencyCount !== bFrequencyCount) return bFrequencyCount - aFrequencyCount;

  const aFrequency = a.frequency ?? 0;
  const bFrequency = b.frequency ?? 0;
  if (aFrequency !== bFrequency) return bFrequency - aFrequency;

  const createdDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (createdDiff !== 0) return createdDiff;

  return a.id.localeCompare(b.id);
}

function normalizeOfflineNewCards(words: SavedWord[]): SavedWord[] {
  const newQueuePositions = new Map(
    words
      .filter(isDictionaryEntryNew)
      .sort(compareNewQueuePosition)
      .map((word, index) => [word.id, index]),
  );
  return words.map((word) => {
    if (!isDictionaryEntryNew(word)) return word;
    return {
      ...word,
      due_at: null,
      queue_position: newQueuePositions.get(word.id) ?? word.queue_position,
    };
  });
}

function readScheduledWords(): SavedWord[] {
  const words = readWords();
  const normalized = normalizeOfflineNewCards(words);
  if (normalized.some((word, index) => word.due_at !== words[index]?.due_at)) {
    writeWords(normalized);
  }
  return normalized;
}

function dailyNewLimitRemaining(words: SavedWord[]): number {
  const dailyLimit = Math.max(getOfflineUser().daily_new_limit || 0, 0);
  if (dailyLimit <= 0) return 0;

  const todayKey = localDateKey(startOfToday());
  const introducedToday = words.filter((word) => word.introduced_date === todayKey).length;
  return Math.max(dailyLimit - introducedToday, 0);
}

function introducedTodayCount(words: SavedWord[]): number {
  const todayKey = localDateKey(startOfToday());
  return words.filter((word) => word.introduced_date === todayKey).length;
}

function withProjectedNewDueDates(words: SavedWord[]): SavedWord[] {
  const dailyLimit = Math.max(getOfflineUser().daily_new_limit || 0, 0);
  if (dailyLimit <= 0) {
    return words.map((word) => (
      isDictionaryEntryNew(word) ? { ...word, projected_due_at: null } : word
    ));
  }

  const introducedToday = introducedTodayCount(words);
  const today = startOfToday();
  return words.map((word) => {
    if (!isDictionaryEntryNew(word)) return word;
    if (word.queue_position == null) return { ...word, projected_due_at: null };
    const queuePosition = word.queue_position;
    const dayOffset = Math.floor((queuePosition + introducedToday) / dailyLimit);
    const projectedDate = new Date(today);
    projectedDate.setDate(today.getDate() + dayOffset);
    return { ...word, projected_due_at: localDateTimeAtStartOfDay(projectedDate) };
  });
}

function availableNewWords(words: SavedWord[], limit = dailyNewLimitRemaining(words)): SavedWord[] {
  if (limit <= 0) return [];
  return words
    .filter(isDictionaryEntryNew)
    .sort(compareNewEntries)
    .slice(0, limit);
}

function basicDefinition(word: string, sentence?: string | null) {
  const context = sentence?.trim();
  return context ? `Saved offline from: ${context}` : `Saved offline. Add a definition when the server is available.`;
}

function offlineFrequencyDiagnostic(word: string, targetLanguage: string | null | undefined, emit = false) {
  const diagnostic = {
    code: 'offline_frequency_rank_unavailable',
    severity: 'warning' as const,
    title: 'Saved ranking unavailable offline',
    message: 'This entry was saved offline without a catalog rank. The warning remains visible until the server resolves it during synchronization.',
    source: 'web.offline-dictionary',
    operation: 'save-word',
    detail: `language=${targetLanguage || 'unknown'}; word=${word}`,
  };
  if (emit) {
    emitFallbackDiagnostic(diagnostic, {
      source: 'web.offline-dictionary',
      operation: 'save-word',
    });
  }
  return diagnostic;
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
    rank_version_id: data.rank_version_id ?? null,
    lemma_frequency_rank: data.lemma_frequency_rank ?? null,
    sense_rank: data.sense_rank ?? null,
    lemma_occurrences_per_billion: data.lemma_occurrences_per_billion ?? null,
    frequency_confidence: data.frequency_confidence ?? 'unavailable',
    frequency_sources: data.frequency_sources ?? [],
    ranking_diagnostics: data.sense_rank == null
      ? [offlineFrequencyDiagnostic(data.word, data.target_language)]
      : [],
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
    relearning_date: null,
  };
}

function reviewLocalWord(id: string, answer: SrsAnswer): SavedWord | null {
  const words = readScheduledWords();
  const index = words.findIndex((word) => word.id === id);
  if (index === -1) return null;

  const card = words[index];
  const now = new Date();
  const updated = applyAnswerLocally(card, answer, now);

  words[index] = updated;
  writeWords(words);
  return updated;
}

function dueWords(): SavedWord[] {
  const now = Date.now();
  const words = readScheduledWords();
  const availableNewIds = new Set(availableNewWords(words).map((word) => word.id));

  return words
    .filter((word) => {
      if (isDictionaryEntryNew(word)) return availableNewIds.has(word.id);
      if (!word.due_at) return true;
      const learnAhead = word.learning_step !== null ? 20 * 60 * 1000 : 0;
      return new Date(word.due_at).getTime() <= now + learnAhead;
    })
    .sort((a, b) => {
      const aNew = isDictionaryEntryNew(a);
      const bNew = isDictionaryEntryNew(b);
      if (aNew !== bNew) return aNew ? -1 : 1;
      if (aNew && bNew) return compareNewEntries(a, b);
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
}

function dictionaryGroups(searchParams: URLSearchParams) {
  const page = Math.max(0, Number(searchParams.get('page') || 0));
  const limit = Math.max(1, Number(searchParams.get('limit') || 20));
  const search = searchParams.get('search') || '';
  const sort = (searchParams.get('sort') || 'queue') as DictionarySortMode;
  const words = withProjectedNewDueDates(readScheduledWords());
  const groups = buildDictionaryGroups(words, search, sort);
  const availableNewIds = new Set(availableNewWords(words).map((word) => word.id));
  const dueNextGroupKeys = groups
    .filter((group) => group.entries.some((entry) => availableNewIds.has(entry.id)))
    .map((group) => group.key);
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
    nextCursor: adjustedPage < totalPages - 1 ? `offline:${adjustedPage + 1}` : null,
    hasMore: adjustedPage < totalPages - 1,
  };
}

function saveWord(data: SaveWordData) {
  const words = readWords();
  const targetLanguage = data.target_language || getOfflineUser().target_language || null;
  const existing = words.find((word) => {
    const canonicalWord = (word.lemma || word.word).trim().normalize('NFC').toLocaleLowerCase();
    const incomingWord = (data.lemma || data.word).trim().normalize('NFC').toLocaleLowerCase();
    const sameSense = canonicalWord === incomingWord
      && word.definition.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
        === (data.definition || basicDefinition(data.word, data.sentence_context)).trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    return sameSense && word.target_language === targetLanguage;
  });

  if (existing) return { ...existing, _created: false };

  if (data.sense_rank == null) {
    offlineFrequencyDiagnostic(data.word, targetLanguage, true);
  }

  const saved = toSavedWord({ ...data, target_language: targetLanguage || undefined });
  const nextWords = normalizeOfflineNewCards([saved, ...words]);
  writeWords(nextWords);
  return { ...nextWords[0], _created: true };
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
    return { handled: true, data: readScheduledWords() };
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
    const words = readScheduledWords();
    return { handled: true, data: availableNewWords(words) };
  }

  if (normalizedPath === '/dictionary/new-preview' && upperMethod === 'GET') {
    markOfflineEnabled();
    const limit = Math.max(1, Number(url.searchParams.get('limit') || 10));
    return { handled: true, data: availableNewWords(readScheduledWords(), limit) };
  }

  if (normalizedPath === '/dictionary/word-groups' && upperMethod === 'GET') {
    markOfflineEnabled();
    return { handled: true, data: dictionaryGroups(url.searchParams) };
  }

  if (normalizedPath === '/home/student-dashboard' && upperMethod === 'GET') {
    markOfflineEnabled();
    const words = readScheduledWords();
    return {
      handled: true,
      data: {
        newToday: availableNewWords(words),
        dueWords: dueWords(),
        pendingClasswork: { count: 0, posts: [] },
        wordsAddedToday: words.filter((word) => {
          const created = new Date(word.created_at || 0);
          const now = new Date();
          return created.getFullYear() === now.getFullYear()
            && created.getMonth() === now.getMonth()
            && created.getDate() === now.getDate();
        }).length,
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
