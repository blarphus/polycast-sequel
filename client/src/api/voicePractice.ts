import { request } from './core';

export type FeedbackLanguageMode = 'native' | 'target';
export type VoicePracticeResult = 'correct' | 'partial' | 'incorrect';

export interface VoicePracticeSentence {
  id: string;
  native_prompt: string;
  expected_target: string;
  difficulty: string | null;
  source_type: 'classwork' | 'video' | 'news' | 'dictionary';
  source_ref_id: string | null;
  focus_words: string[];
  assignment_priority: boolean;
}

export interface VoicePracticeSession {
  sessionId: string;
  nativeLanguage: string;
  targetLanguage: string;
  cefrLevel: string | null;
  feedbackLanguageMode: FeedbackLanguageMode;
  sentences: VoicePracticeSentence[];
  initialPromptIndex: number;
  completedAt?: string | null;
}

export interface VoicePracticeIssueNote {
  type:
    | 'grammar'
    | 'word_choice'
    | 'word_order'
    | 'missing_content'
    | 'untranslated_word'
    | 'register'
    | 'pronunciation_heard_as';
  message: string;
}

export interface VoiceGradeResult {
  result: VoicePracticeResult;
  score: number;
  annotatedUserAnswer: string;
  correctedAnswer: string;
  issueNotes: VoicePracticeIssueNote[];
  spokenFeedback: string;
  issueTypeCounts: Record<string, number>;
}

export interface VoicePracticeSummary {
  sessionId: string;
  promptCount: number;
  answeredCount: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  skippedCount: number;
  durationSeconds: number;
  feedbackLanguageMode: FeedbackLanguageMode;
  issueCounts: Record<string, number>;
  sourceBreakdown: Record<string, number>;
}

export interface RealtimeSessionResponse {
  client_secret?: { value?: string | null } | null;
  [key: string]: unknown;
}

export function createVoicePracticeSession(count = 10, feedbackLanguageMode: FeedbackLanguageMode = 'native') {
  return request<VoicePracticeSession>('/practice/voice/sessions', {
    method: 'POST',
    body: { count, feedbackLanguageMode },
  });
}

export function getVoicePracticeSession(sessionId: string) {
  return request<VoicePracticeSession>(`/practice/voice/sessions/${sessionId}`);
}

export function gradeVoicePracticeTurn(
  sessionId: string,
  data: {
    sentenceId: string;
    userTranscript: string;
    feedbackLanguageMode: FeedbackLanguageMode;
  },
) {
  return request<VoiceGradeResult>(`/practice/voice/sessions/${sessionId}/grade`, {
    method: 'POST',
    body: data,
  });
}

export function completeVoicePracticeSession(
  sessionId: string,
  data: {
    answeredCount: number;
    correctCount: number;
    partialCount: number;
    incorrectCount: number;
    skippedCount: number;
    durationSeconds: number;
    feedbackLanguageMode: FeedbackLanguageMode;
    issueCounts: Record<string, number>;
  },
) {
  return request<VoicePracticeSummary>(`/practice/voice/sessions/${sessionId}/complete`, {
    method: 'POST',
    body: data,
  });
}

export function createVoiceRealtimeToken(data: {
  nativeLanguage: string;
  targetLanguage: string;
  feedbackLanguageMode: FeedbackLanguageMode;
}) {
  return request<RealtimeSessionResponse>('/practice/voice/realtime-token', {
    method: 'POST',
    body: data,
  });
}

export function transcribeVoicePracticeTurn(data: {
  audioBase64: string;
  mimeType: string;
  nativeLanguage?: string;
  targetLanguage?: string;
}) {
  return request<{ transcript: string }>('/practice/voice/transcribe', {
    method: 'POST',
    body: data,
  });
}

export async function synthesizeVoicePracticeFeedback(data: {
  text: string;
  languageCode?: string;
}) {
  const res = await fetch('/api/practice/voice/speak', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    let message = 'Failed to synthesize voice feedback';
    try {
      const payload = await res.json();
      message = payload.error || payload.message || message;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  return res.blob();
}
