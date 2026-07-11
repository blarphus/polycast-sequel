import { request } from './core';

export interface DrillSession {
  id: string;
  tense_key: string;
  verb_filter: string;
  question_count: number;
  correct_count: number;
  duration_seconds: number;
  created_at: string;
}

export function getDrillSessions() {
  return request<{ sessions: DrillSession[] }>('/practice/drill-sessions');
}

export function saveDrillSession(data: {
  tense_key: string;
  verb_filter: string;
  question_count: number;
  correct_count: number;
  duration_seconds: number;
}) {
  return request<{ id: string }>('/practice/drill-sessions', {
    method: 'POST',
    body: data,
  });
}

export type VocabularyExerciseKind =
  | 'meaning_choice'
  | 'word_choice'
  | 'pair_match'
  | 'context_choice'
  | 'context_type'
  | 'listen_meaning'
  | 'listen_type';

export interface ExerciseOption { id: string; text: string }
export interface VocabularyExercise {
  id: string;
  position: number;
  total: number;
  kind: VocabularyExerciseKind;
  prompt: {
    instruction: string;
    word?: string;
    meaning?: string;
    sentence?: string;
    imageUrl?: string | null;
    audioText?: string;
    language?: string | null;
    options?: ExerciseOption[];
    left?: ExerciseOption[];
    right?: ExerciseOption[];
  };
  retryOf: string | null;
}

export interface LearningSession {
  id: string;
  kind: 'flashcards' | 'vocabulary';
  total_items: number;
  answered_count: number;
  correct_count: number;
  status: 'active' | 'completed' | 'abandoned';
  awarded_xp: number;
}

export interface Diagnostic { code: string; title: string; message: string }
export type ExerciseResponse =
  | { optionId: string }
  | { text: string }
  | { pairs: { leftId: string; rightId: string }[] };

export function createLearningSession(kind: 'flashcards' | 'vocabulary', sourceVideoId?: string) {
  return request<{
    session: LearningSession;
    exercise: VocabularyExercise | null;
    diagnostics: Diagnostic[];
  }>('/learning-sessions', {
    method: 'POST',
    body: { kind, sourceVideoId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
}

export function answerVocabularyExercise(sessionId: string, exerciseId: string, response: ExerciseResponse) {
  return request<{
    correct: boolean;
    correctAnswer: string;
    nextExercise: VocabularyExercise | null;
    session: LearningSession;
  }>(`/learning-sessions/${sessionId}/answers`, {
    method: 'POST',
    body: { exerciseId, response },
  });
}

export function completeLearningSession(sessionId: string) {
  return request<{ awardedXp: number }>(`/learning-sessions/${sessionId}/complete`, {
    method: 'POST',
    body: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
}
