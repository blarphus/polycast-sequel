import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudentDetail from '../pages/StudentDetail';

const dueLaterToday = new Date();
dueLaterToday.setHours(23, 0, 0, 0);
const dueTomorrow = new Date(dueLaterToday);
dueTomorrow.setDate(dueTomorrow.getDate() + 1);

const words = [
  {
    id: 'due-word',
    word: 'hacer',
    translation: 'to make',
    definition: 'to do or make',
    part_of_speech: 'verb',
    image_url: null,
    sentence_context: 'Ella hace pan.',
    example_sentence: 'Hago la cena.',
    frequency: 10,
    frequency_count: 1000,
    lemma_frequency_rank: 12,
    due_at: dueLaterToday.toISOString(),
    last_reviewed_at: null,
    created_at: '2026-07-20T12:00:00Z',
    correct_count: 0,
    incorrect_count: 0,
    srs_stage: 'new' as const,
  },
  {
    id: 'later-word',
    word: 'zapato',
    translation: 'shoe',
    definition: 'a shoe',
    part_of_speech: 'noun',
    image_url: null,
    sentence_context: null,
    example_sentence: null,
    frequency: 7,
    frequency_count: 500,
    lemma_frequency_rank: 850,
    due_at: dueTomorrow.toISOString(),
    last_reviewed_at: '2026-07-23T12:00:00Z',
    created_at: '2026-07-19T12:00:00Z',
    correct_count: 3,
    incorrect_count: 1,
    srs_stage: 'review' as const,
  },
  {
    id: 'alphabetical-word',
    word: 'abeja',
    translation: 'bee',
    definition: 'a bee',
    part_of_speech: 'noun',
    image_url: null,
    sentence_context: null,
    example_sentence: null,
    frequency: 3,
    frequency_count: 20,
    lemma_frequency_rank: 12_000,
    due_at: dueTomorrow.toISOString(),
    last_reviewed_at: null,
    created_at: '2026-07-18T12:00:00Z',
    correct_count: 0,
    incorrect_count: 0,
    srs_stage: 'new' as const,
  },
];

vi.mock('../api', () => ({
  getStudentStats: vi.fn(() => Promise.resolve({
    student: {
      id: 'student-1',
      username: 'learner',
      display_name: 'Learner',
      created_at: '2026-07-01T12:00:00Z',
    },
    stats: {
      totalWords: 3,
      wordsLearned: 1,
      wordsDue: 0,
      wordsNew: 1,
      wordsInLearning: 0,
      wordsMastered: 0,
      daysActiveThisWeek: 1,
      totalReviews: 4,
      accuracy: 0.75,
      lastReviewedAt: '2026-07-23T12:00:00Z',
      reviewHistoryPartial: false,
      reviewHistoryAccurateFrom: null,
      streak: 1,
    },
    activity: [],
    recentSessions: [],
    wordLists: [],
    words,
  })),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('teacher student vocabulary panel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('defaults to due-today cards and can reveal the complete dictionary', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={['/students/student-1?classroomId=class-1']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <Routes>
            <Route path="/students/:studentId" element={<StudentDetail />} />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('.sd-vocab-row strong')?.textContent).toBe('hacer');
    expect(container.textContent).toContain('to do or make');
    expect(container.querySelectorAll('.sd-vocab-row')).toHaveLength(1);

    const allWords = Array.from(container.querySelectorAll<HTMLButtonElement>('.sd-vocab-toggle button'))
      .find((button) => button.textContent?.includes('All words'));
    expect(allWords).toBeDefined();
    act(() => allWords?.click());

    expect(container.querySelectorAll('.sd-vocab-row')).toHaveLength(3);
    expect(container.textContent).toContain('zapato');

    const sort = container.querySelector<HTMLSelectElement>('.sd-vocab-sort select');
    expect(sort).not.toBeNull();
    act(() => {
      sort!.value = 'alphabetical';
      sort!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('.sd-vocab-row strong')?.textContent).toBe('abeja');
  });
});
