import type { SavedWord } from '../api';

export type DictionarySortMode = 'queue' | 'date' | 'az' | 'freq-high' | 'freq-low' | 'due';

export interface DictionaryWordGroup {
  key: string;
  word: string;
  target_language: string | null;
  entries: SavedWord[];
  primaryEntry: SavedWord;
  hasNew: boolean;
  hasPriority: boolean;
  maxFrequency: number | null;
  earliestDueTime: number;
  earliestCreatedTime: number;
  mostRecentCreatedTime: number;
  nextNewEntry: SavedWord | null;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function getCreatedTime(word: SavedWord): number {
  return new Date(word.created_at).getTime();
}

function getDueTime(word: SavedWord): number {
  if (!word.due_at) return Number.POSITIVE_INFINITY;
  const time = new Date(word.due_at).getTime();
  return isFiniteNumber(time) ? time : Number.POSITIVE_INFINITY;
}

export function isDictionaryEntryNew(word: SavedWord): boolean {
  return word.srs_interval === 0 && word.learning_step === null && !word.last_reviewed_at;
}

function compareNewEntries(a: SavedWord, b: SavedWord): number {
  const aQueue = a.queue_position ?? Number.POSITIVE_INFINITY;
  const bQueue = b.queue_position ?? Number.POSITIVE_INFINITY;
  if (aQueue !== bQueue) return aQueue - bQueue;

  const aPriority = a.priority ? 0 : 1;
  const bPriority = b.priority ? 0 : 1;
  if (aPriority !== bPriority) return aPriority - bPriority;

  const aFrequency = a.frequency ?? 0;
  const bFrequency = b.frequency ?? 0;
  if (aFrequency !== bFrequency) return bFrequency - aFrequency;

  return getCreatedTime(a) - getCreatedTime(b);
}

function compareDisplayEntries(a: SavedWord, b: SavedWord): number {
  const aIsNew = isDictionaryEntryNew(a);
  const bIsNew = isDictionaryEntryNew(b);
  if (aIsNew && bIsNew) return compareNewEntries(a, b);
  if (aIsNew) return -1;
  if (bIsNew) return 1;

  const aLearningRank = a.learning_step !== null ? 0 : 1;
  const bLearningRank = b.learning_step !== null ? 0 : 1;
  if (aLearningRank !== bLearningRank) return aLearningRank - bLearningRank;

  const aDueTime = getDueTime(a);
  const bDueTime = getDueTime(b);
  if (aDueTime !== bDueTime) return aDueTime - bDueTime;

  return getCreatedTime(b) - getCreatedTime(a);
}

function compareQueueGroups(a: DictionaryWordGroup, b: DictionaryWordGroup): number {
  if (a.nextNewEntry && b.nextNewEntry) {
    return compareNewEntries(a.nextNewEntry, b.nextNewEntry);
  }
  if (a.nextNewEntry) return -1;
  if (b.nextNewEntry) return 1;
  return a.earliestDueTime - b.earliestDueTime;
}

export function buildDictionaryGroups(words: SavedWord[], search: string, sort: DictionarySortMode): DictionaryWordGroup[] {
  const query = search.trim().toLowerCase();
  const filtered = query
    ? words.filter((word) =>
      word.word.toLowerCase().includes(query) ||
      word.translation.toLowerCase().includes(query),
    )
    : words;

  const groupMap = new Map<string, SavedWord[]>();
  for (const word of filtered) {
    const key = `${word.word}|${word.target_language || ''}`;
    const group = groupMap.get(key);
    if (group) group.push(word);
    else groupMap.set(key, [word]);
  }

  const groups = Array.from(groupMap.entries()).map(([key, groupEntries]) => {
    const entries = [...groupEntries].sort(compareDisplayEntries);
    const newEntries = entries.filter(isDictionaryEntryNew).sort(compareNewEntries);
    const dueTimes = entries.map(getDueTime).filter(isFiniteNumber);
    const createdTimes = entries.map(getCreatedTime);
    const maxFrequency = Math.max(...entries.map((entry) => entry.frequency ?? 0));

    return {
      key,
      word: entries[0].word,
      target_language: entries[0].target_language,
      entries,
      primaryEntry: entries[0],
      hasNew: newEntries.length > 0,
      hasPriority: entries.some((entry) => entry.priority),
      maxFrequency: maxFrequency > 0 ? maxFrequency : null,
      earliestDueTime: dueTimes.length > 0 ? Math.min(...dueTimes) : Number.POSITIVE_INFINITY,
      earliestCreatedTime: Math.min(...createdTimes),
      mostRecentCreatedTime: Math.max(...createdTimes),
      nextNewEntry: newEntries[0] ?? null,
    };
  });

  switch (sort) {
    case 'queue':
      groups.sort(compareQueueGroups);
      break;
    case 'az':
      groups.sort((a, b) => a.word.localeCompare(b.word));
      break;
    case 'freq-high':
      groups.sort((a, b) => (b.maxFrequency ?? 0) - (a.maxFrequency ?? 0));
      break;
    case 'freq-low':
      groups.sort((a, b) => (a.maxFrequency ?? 0) - (b.maxFrequency ?? 0));
      break;
    case 'due':
      groups.sort((a, b) => {
        if (a.nextNewEntry && b.nextNewEntry) return compareNewEntries(a.nextNewEntry, b.nextNewEntry);
        if (a.nextNewEntry) return -1;
        if (b.nextNewEntry) return 1;
        return a.earliestDueTime - b.earliestDueTime;
      });
      break;
    default:
      groups.sort((a, b) => b.mostRecentCreatedTime - a.mostRecentCreatedTime);
      break;
  }

  return groups;
}

export function getDueNextGroupKeys(groups: DictionaryWordGroup[], dailyNewLimit: number): Set<string> {
  if (dailyNewLimit <= 0) return new Set();

  const nextGroups = new Set<string>();
  const queuedNewEntries = groups
    .flatMap((group) => group.entries
      .filter(isDictionaryEntryNew)
      .map((entry) => ({ groupKey: group.key, entry })))
    .sort((a, b) => compareNewEntries(a.entry, b.entry))
    .slice(0, dailyNewLimit);

  for (const item of queuedNewEntries) {
    nextGroups.add(item.groupKey);
  }

  return nextGroups;
}
