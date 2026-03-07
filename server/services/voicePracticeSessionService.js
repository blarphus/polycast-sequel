import pool from '../db.js';
import { callGemini } from '../enrichWord.js';
import { buildVoicePracticeSentenceSet } from './voicePracticeSourceService.js';

function safeJsonParse(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Empty Gemini response');
  const withoutFence = trimmed.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(withoutFence);
}

function normalizeIssueCounts(issueNotes = []) {
  const counts = {
    grammar: 0,
    word_choice: 0,
    word_order: 0,
    missing_content: 0,
    untranslated_word: 0,
    register: 0,
    pronunciation_heard_as: 0,
  };
  for (const note of issueNotes) {
    if (note?.type && counts[note.type] !== undefined) {
      counts[note.type] += 1;
    }
  }
  return counts;
}

export async function createVoicePracticeSession({
  userId,
  count = 10,
  feedbackLanguageMode = 'native',
}) {
  const { rows: [user] } = await pool.query(
    `SELECT native_language, target_language, cefr_levels
       FROM users
      WHERE id = $1`,
    [userId],
  );
  if (!user) {
    throw new Error('User not found');
  }
  if (!user.native_language || !user.target_language) {
    throw new Error('Set both native and target language before starting voice practice');
  }
  const cefrLevel = user.cefr_levels?.[user.target_language] || null;
  const sentences = await buildVoicePracticeSentenceSet({
    userId,
    nativeLanguage: user.native_language,
    targetLanguage: user.target_language,
    count,
  });

  const sourceBreakdown = sentences.reduce((acc, sentence) => {
    acc[sentence.source_type] = (acc[sentence.source_type] || 0) + 1;
    return acc;
  }, {});

  const { rows: [session] } = await pool.query(
    `INSERT INTO voice_practice_sessions
      (user_id, native_language, target_language, cefr_level, source_mode, prompt_count,
       feedback_language_mode, source_breakdown_json, sentences_json)
     VALUES ($1, $2, $3, $4, 'mixed_priority', $5, $6, $7::jsonb, $8::jsonb)
     RETURNING *`,
    [
      userId,
      user.native_language,
      user.target_language,
      cefrLevel,
      sentences.length,
      feedbackLanguageMode,
      JSON.stringify(sourceBreakdown),
      JSON.stringify(sentences),
    ],
  );

  return {
    sessionId: session.id,
    nativeLanguage: session.native_language,
    targetLanguage: session.target_language,
    cefrLevel: session.cefr_level,
    feedbackLanguageMode: session.feedback_language_mode,
    sentences,
    initialPromptIndex: 0,
  };
}

export async function getVoicePracticeSession(sessionId, userId) {
  const { rows: [session] } = await pool.query(
    `SELECT * FROM voice_practice_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  if (!session) return null;
  return {
    sessionId: session.id,
    nativeLanguage: session.native_language,
    targetLanguage: session.target_language,
    cefrLevel: session.cefr_level,
    feedbackLanguageMode: session.feedback_language_mode,
    sentences: Array.isArray(session.sentences_json) ? session.sentences_json : [],
    initialPromptIndex: 0,
    completedAt: session.completed_at,
  };
}

export async function gradeVoicePracticeTurn({
  sessionId,
  userId,
  sentenceId,
  userTranscript,
  feedbackLanguageMode = 'native',
}) {
  const session = await getVoicePracticeSession(sessionId, userId);
  if (!session) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }

  const sentence = session.sentences.find((item) => item.id === sentenceId);
  if (!sentence) {
    const err = new Error('Sentence not found in session');
    err.status = 404;
    throw err;
  }

  const prompt = `You are grading one spoken translation exercise.

Native language: ${session.nativeLanguage}
Target language: ${session.targetLanguage}
Spoken feedback language mode: ${feedbackLanguageMode}

Expected target sentence:
${sentence.expected_target}

Student transcript:
${userTranscript}

Return JSON only with exactly these fields:
- result: "correct" | "partial" | "incorrect"
- score: integer 0-100
- annotatedUserAnswer: the student's target-language answer with words/phrases that should be removed or replaced wrapped in double tildes like ~~this~~
- correctedAnswer: the clean best target-language sentence
- issueNotes: array of up to 3 objects with:
  - type: one of grammar, word_choice, word_order, missing_content, untranslated_word, register, pronunciation_heard_as
  - message: short explanation
- spokenFeedback: one short sentence in the requested spoken feedback language

Rules:
- Accept valid synonyms that preserve the meaning (e.g. "regra" vs "norma" for "rule", "casa" vs "lar" for "home"). Do NOT mark synonym choices as errors — the student is translating from meaning, not matching a specific wording.
- Minor accent or spelling slips that do not change meaning can still be correct.
- If the student leaves one or more words in the native language but the rest is good, prefer "partial" over "incorrect".
- Use issueNotes sparingly — only flag genuine errors, not stylistic preferences.
- Do not include any extra fields or commentary.`;

  const raw = await callGemini(prompt, {
    thinkingConfig: { thinkingBudget: 0 },
    maxOutputTokens: 500,
    responseMimeType: 'application/json',
  });
  const parsed = safeJsonParse(raw);
  const issueNotes = Array.isArray(parsed.issueNotes) ? parsed.issueNotes.slice(0, 3) : [];
  const issueTypeCounts = normalizeIssueCounts(issueNotes);

  return {
    result: ['correct', 'partial', 'incorrect'].includes(parsed.result) ? parsed.result : 'incorrect',
    score: Number.isFinite(parsed.score) ? parsed.score : 0,
    annotatedUserAnswer: String(parsed.annotatedUserAnswer || userTranscript || ''),
    correctedAnswer: String(parsed.correctedAnswer || sentence.expected_target),
    issueNotes,
    spokenFeedback: String(parsed.spokenFeedback || ''),
    issueTypeCounts,
  };
}

export async function completeVoicePracticeSession({
  sessionId,
  userId,
  answeredCount,
  correctCount,
  partialCount,
  incorrectCount,
  skippedCount,
  durationSeconds,
  feedbackLanguageMode = 'native',
  issueCounts = {},
}) {
  const { rows: [row] } = await pool.query(
    `UPDATE voice_practice_sessions
        SET answered_count = $1,
            correct_count = $2,
            partial_count = $3,
            incorrect_count = $4,
            skipped_count = $5,
            duration_seconds = $6,
            feedback_language_mode = $7,
            issue_counts_json = $8::jsonb,
            completed_at = NOW()
      WHERE id = $9 AND user_id = $10
      RETURNING *`,
    [
      answeredCount,
      correctCount,
      partialCount,
      incorrectCount,
      skippedCount,
      durationSeconds,
      feedbackLanguageMode,
      JSON.stringify(issueCounts),
      sessionId,
      userId,
    ],
  );

  if (!row) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }

  return {
    sessionId: row.id,
    promptCount: row.prompt_count,
    answeredCount: row.answered_count,
    correctCount: row.correct_count,
    partialCount: row.partial_count,
    incorrectCount: row.incorrect_count,
    skippedCount: row.skipped_count,
    durationSeconds: row.duration_seconds,
    feedbackLanguageMode: row.feedback_language_mode,
    issueCounts: row.issue_counts_json || {},
    sourceBreakdown: row.source_breakdown_json || {},
  };
}
