import { describe, expect, it } from 'vitest';
import { buildDictionaryGroups, getDueNextGroupKeys } from '../utils/dictionaryGroups';
import type { SavedWord } from '../api';

function makeWord(overrides: any): SavedWord {
  return {
    id: overrides.id,
    word: overrides.word,
    translation: overrides.translation ?? '',
    definition: overrides.definition ?? '',
    target_language: overrides.target_language ?? 'es',
    sentence_context: overrides.sentence_context ?? null,
    created_at: overrides.created_at ?? '2026-03-14T10:00:00.000Z',
    frequency: overrides.frequency ?? null,
    frequency_count: overrides.frequency_count ?? null,
    example_sentence: overrides.example_sentence ?? null,
    sentence_translation: overrides.sentence_translation ?? null,
    part_of_speech: overrides.part_of_speech ?? null,
    srs_interval: overrides.srs_interval ?? 0,
    due_at: overrides.due_at ?? null,
    last_reviewed_at: overrides.last_reviewed_at ?? null,
    correct_count: overrides.correct_count ?? 0,
    incorrect_count: overrides.incorrect_count ?? 0,
    ease_factor: overrides.ease_factor ?? 2.5,
    learning_step: overrides.learning_step ?? null,
    image_url: overrides.image_url ?? null,
    lemma: overrides.lemma ?? null,
    forms: overrides.forms ?? null,
    priority: overrides.priority ?? false,
    image_term: overrides.image_term ?? null,
    queue_position: overrides.queue_position ?? null,
  };
}

describe('dictionaryGroups', () => {
  it('marks exact due-next groups from the queued new cards', () => {
    const groups = buildDictionaryGroups([
      makeWord({ id: 'a1', word: 'alpha', queue_position: 1 }),
      makeWord({ id: 'b1', word: 'beta', queue_position: 2 }),
      makeWord({ id: 'b2', word: 'beta', queue_position: 3 }),
      makeWord({ id: 'c1', word: 'charlie', queue_position: 4 }),
    ], '', 'queue');

    const dueNext = getDueNextGroupKeys(groups, 2);

    expect(Array.from(dueNext)).toEqual(['alpha|es', 'beta|es']);
  });

  it('uses the most relevant entry as the primary badge source', () => {
    const groups = buildDictionaryGroups([
      makeWord({
        id: 'mixed-reviewed',
        word: 'hola',
        srs_interval: 86400,
        due_at: '2026-03-20T10:00:00.000Z',
        last_reviewed_at: '2026-03-13T10:00:00.000Z',
      }),
      makeWord({
        id: 'mixed-new',
        word: 'hola',
        queue_position: 0,
        created_at: '2026-03-14T11:00:00.000Z',
      }),
    ], '', 'queue');

    expect(groups[0].primaryEntry.id).toBe('mixed-new');
  });

  it('keeps new words in frequency order even when queue positions differ', () => {
    const groups = buildDictionaryGroups([
      makeWord({ id: 'low', word: 'louvado', frequency: 4, queue_position: 0 }),
      makeWord({ id: 'high', word: 'prefeito', frequency: 5, queue_position: 99 }),
      makeWord({ id: 'higher', word: 'cargo', frequency: 7, queue_position: 50 }),
    ], '', 'queue');

    expect(groups.map((group) => group.word)).toEqual(['cargo', 'prefeito', 'louvado']);
    expect(Array.from(getDueNextGroupKeys(groups, 2))).toEqual(['cargo|es', 'prefeito|es']);
  });
});
