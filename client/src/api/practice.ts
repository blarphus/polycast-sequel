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

export interface QuizQuestion {
  type: 'conjugation' | 'grammar' | 'translation';
  prompt: string;
  expected: string;
  input_mode: 'word_bank' | 'free_type';
  distractors: string[];
  hint: string;
  saved_word_id: string | null;
}

export interface QuizAnswerResult {
  isCorrect: boolean;
  expectedAnswer: string;
  aiFeedback: string;
}

export interface QuizSessionResult {
  sessionId: string;
  questionCount: number;
  correctCount: number;
  percentage: number;
  answers: {
    questionIndex: number;
    questionType: string;
    prompt: string;
    expectedAnswer: string;
    userAnswer: string;
    isCorrect: boolean;
    aiFeedback: string;
  }[];
}

export function generateQuiz(videoId?: string, count?: number) {
  const body: Record<string, unknown> = {};
  if (videoId) body.videoId = videoId;
  if (count) body.count = count;
  return request<{ questions: QuizQuestion[] }>('/practice/generate', {
    method: 'POST',
    body,
  });
}

export function createQuizSession(mode: 'video' | 'standalone', questions: QuizQuestion[], videoId?: string) {
  return request<{ sessionId: string }>('/practice/sessions', {
    method: 'POST',
    body: { videoId, mode, questions },
  });
}

export function submitQuizAnswer(sessionId: string, questionIndex: number, userAnswer: string) {
  return request<QuizAnswerResult>(`/practice/sessions/${sessionId}/answer`, {
    method: 'POST',
    body: { questionIndex, userAnswer },
  });
}

export function completeQuizSession(sessionId: string) {
  return request<QuizSessionResult>(`/practice/sessions/${sessionId}/complete`, {
    method: 'POST',
  });
}
