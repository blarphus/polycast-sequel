// ---------------------------------------------------------------------------
// routes/practice.js -- Practice quiz generation, sessions, answers, and SRS
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';
import { callGemini } from '../enrichWord.js';
import { validate } from '../lib/validate.js';
import { computeNextReview } from '../lib/srsAlgorithm.js';
import logger from '../logger.js';

const router = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const generateBody = z.object({
  videoId: z.string().uuid().optional(),
  count: z.number().int().min(5).max(30).optional(),
});

const createSessionBody = z.object({
  videoId: z.string().uuid().optional(),
  mode: z.enum(['video', 'standalone']),
  questions: z.array(z.object({
    type: z.string(),
    prompt: z.string(),
    expected: z.string(),
    input_mode: z.enum(['word_bank', 'free_type']),
    distractors: z.array(z.string()).optional(),
    hint: z.string().optional(),
    saved_word_id: z.string().uuid().optional().nullable(),
  })),
});

const answerBody = z.object({
  questionIndex: z.number().int().min(0),
  userAnswer: z.string().min(1),
});

const sessionIdParam = z.object({
  id: z.string().uuid('Invalid session ID'),
});

// ---------------------------------------------------------------------------
// POST /api/practice/generate -- Generate quiz questions via Gemini
// ---------------------------------------------------------------------------

router.post('/api/practice/generate', authMiddleware, validate({ body: generateBody }), async (req, res) => {
  const { videoId, count = 10 } = req.body;

  try {
    const { rows: [userRow] } = await pool.query(
      'SELECT native_language, target_language, cefr_level FROM users WHERE id = $1',
      [req.userId],
    );
    if (!userRow) return res.status(404).json({ error: 'User not found' });

    const { native_language, target_language, cefr_level } = userRow;

    // Gather context: transcript text and/or saved words
    let transcriptText = '';
    let savedWordsContext = '';

    if (videoId) {
      const { rows: [video] } = await pool.query(
        'SELECT transcript, language FROM videos WHERE id = $1',
        [videoId],
      );
      if (!video) return res.status(404).json({ error: 'Video not found' });
      if (video.transcript && Array.isArray(video.transcript)) {
        transcriptText = video.transcript.map((s) => s.text).join(' ');
      }
    }

    // Fetch user's saved words for this target language
    const { rows: savedWords } = await pool.query(
      `SELECT id, word, translation, definition, part_of_speech, lemma
       FROM saved_words
       WHERE user_id = $1 AND target_language = $2
       ORDER BY created_at DESC LIMIT 50`,
      [req.userId, target_language],
    );

    if (savedWords.length > 0) {
      savedWordsContext = savedWords.map((w) =>
        `${w.word} (${w.part_of_speech || 'unknown'}): ${w.translation} — ${w.definition} [id:${w.id}]`
      ).join('\n');
    }

    if (!transcriptText && savedWords.length === 0) {
      return res.status(400).json({ error: 'No transcript or saved words available to generate questions from' });
    }

    const prompt = buildGenerationPrompt({
      transcriptText,
      savedWordsContext,
      nativeLang: native_language,
      targetLang: target_language,
      cefrLevel: cefr_level,
      count,
    });

    const raw = await callGemini(prompt, {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 4000,
      responseMimeType: 'application/json',
    });

    const questions = JSON.parse(raw);

    if (!Array.isArray(questions) || questions.length === 0) {
      logger.error('Gemini returned invalid questions format: %s', raw.slice(0, 500));
      return res.status(500).json({ error: 'Failed to generate quiz questions' });
    }

    return res.json({ questions });
  } catch (err) {
    req.log.error({ err }, 'Error generating practice questions');
    return res.status(500).json({ error: 'Failed to generate quiz questions' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/practice/sessions -- Create a quiz session
// ---------------------------------------------------------------------------

router.post('/api/practice/sessions', authMiddleware, validate({ body: createSessionBody }), async (req, res) => {
  const { videoId, mode, questions } = req.body;

  try {
    const { rows: [userRow] } = await pool.query(
      'SELECT target_language FROM users WHERE id = $1',
      [req.userId],
    );

    const { rows: [session] } = await pool.query(
      `INSERT INTO quiz_sessions (user_id, video_id, mode, target_language, question_count)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.userId, videoId || null, mode, userRow?.target_language, questions.length],
    );

    // Pre-insert answer rows for each question
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      await pool.query(
        `INSERT INTO quiz_answers (session_id, question_index, question_type, input_mode, prompt, expected_answer, saved_word_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [session.id, i, q.type, q.input_mode, q.prompt, q.expected, q.saved_word_id || null],
      );
    }

    return res.json({ sessionId: session.id });
  } catch (err) {
    req.log.error({ err }, 'Error creating practice session');
    return res.status(500).json({ error: 'Failed to create practice session' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/practice/sessions/:id/answer -- Submit one answer
// ---------------------------------------------------------------------------

router.post('/api/practice/sessions/:id/answer', authMiddleware, validate({ params: sessionIdParam, body: answerBody }), async (req, res) => {
  const { id } = req.params;
  const { questionIndex, userAnswer } = req.body;

  try {
    // Verify session belongs to user
    const { rows: [session] } = await pool.query(
      'SELECT * FROM quiz_sessions WHERE id = $1 AND user_id = $2',
      [id, req.userId],
    );
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Get the answer row
    const { rows: [answerRow] } = await pool.query(
      'SELECT * FROM quiz_answers WHERE session_id = $1 AND question_index = $2',
      [id, questionIndex],
    );
    if (!answerRow) return res.status(404).json({ error: 'Question not found' });

    let isCorrect = false;
    let aiFeedback = null;

    if (answerRow.input_mode === 'word_bank' || answerRow.question_type === 'conjugation') {
      // Deterministic check: word_bank has a fixed answer, conjugation is exact match
      isCorrect = userAnswer.trim().toLowerCase() === answerRow.expected_answer.trim().toLowerCase();
      aiFeedback = isCorrect ? 'Correct!' : `The correct answer is: ${answerRow.expected_answer}`;
    } else {
      // AI validation for free-type grammar and translation (multiple valid phrasings)
      const result = await validateWithAI(userAnswer, answerRow.expected_answer, answerRow.question_type, answerRow.prompt);
      isCorrect = result.is_correct;
      aiFeedback = result.feedback;
    }

    // Update the answer row
    await pool.query(
      `UPDATE quiz_answers
       SET user_answer = $1, is_correct = $2, ai_feedback = $3, answered_at = NOW()
       WHERE session_id = $4 AND question_index = $5`,
      [userAnswer, isCorrect, aiFeedback, id, questionIndex],
    );

    // Update session correct_count
    if (isCorrect) {
      await pool.query(
        'UPDATE quiz_sessions SET correct_count = correct_count + 1 WHERE id = $1',
        [id],
      );
    }

    return res.json({
      isCorrect,
      expectedAnswer: answerRow.expected_answer,
      aiFeedback,
    });
  } catch (err) {
    req.log.error({ err }, 'Error submitting practice answer');
    return res.status(500).json({ error: 'Failed to submit answer' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/practice/sessions/:id/complete -- Mark session complete + SRS
// ---------------------------------------------------------------------------

router.post('/api/practice/sessions/:id/complete', authMiddleware, validate({ params: sessionIdParam }), async (req, res) => {
  const { id } = req.params;

  try {
    const { rows: [session] } = await pool.query(
      'SELECT * FROM quiz_sessions WHERE id = $1 AND user_id = $2',
      [id, req.userId],
    );
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Mark completed
    await pool.query(
      'UPDATE quiz_sessions SET completed_at = NOW() WHERE id = $1',
      [id],
    );

    // Fetch all answers for SRS updates
    const { rows: answers } = await pool.query(
      'SELECT * FROM quiz_answers WHERE session_id = $1 ORDER BY question_index',
      [id],
    );

    // SRS updates for answers linked to saved words
    for (const answer of answers) {
      if (!answer.saved_word_id || answer.is_correct === null) continue;

      const { rows: [card] } = await pool.query(
        'SELECT * FROM saved_words WHERE id = $1 AND user_id = $2',
        [answer.saved_word_id, req.userId],
      );
      if (!card) continue;

      const srsAnswer = answer.is_correct ? 'good' : 'again';
      const next = computeNextReview(card, srsAnswer);

      await pool.query(
        `UPDATE saved_words
         SET srs_interval = $1,
             ease_factor = $2,
             learning_step = $3,
             due_at = NOW() + ($4 || ' seconds')::INTERVAL,
             last_reviewed_at = NOW(),
             correct_count = correct_count + $5,
             incorrect_count = incorrect_count + $6
         WHERE id = $7 AND user_id = $8`,
        [
          next.srs_interval,
          next.ease_factor,
          next.learning_step,
          String(next.due_seconds),
          next.correct_delta,
          next.incorrect_delta,
          answer.saved_word_id,
          req.userId,
        ],
      );
    }

    // Return final summary
    const correctCount = answers.filter((a) => a.is_correct === true).length;
    const totalCount = answers.filter((a) => a.is_correct !== null).length;

    return res.json({
      sessionId: id,
      questionCount: totalCount,
      correctCount,
      percentage: totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0,
      answers: answers.map((a) => ({
        questionIndex: a.question_index,
        questionType: a.question_type,
        prompt: a.prompt,
        expectedAnswer: a.expected_answer,
        userAnswer: a.user_answer,
        isCorrect: a.is_correct,
        aiFeedback: a.ai_feedback,
      })),
    });
  } catch (err) {
    req.log.error({ err }, 'Error completing practice session');
    return res.status(500).json({ error: 'Failed to complete practice session' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/practice/conjugations -- Generate conjugation drill batch
// ---------------------------------------------------------------------------

const conjugationBody = z.object({
  count: z.number().int().min(10).max(50).optional(),
});

router.post('/api/practice/conjugations', authMiddleware, validate({ body: conjugationBody }), async (req, res) => {
  const { count = 30 } = req.body;

  try {
    const { rows: [userRow] } = await pool.query(
      'SELECT native_language, target_language, cefr_level FROM users WHERE id = $1',
      [req.userId],
    );
    if (!userRow) return res.status(404).json({ error: 'User not found' });

    const { native_language, target_language, cefr_level } = userRow;

    // Fetch user's saved verbs for personalization
    const { rows: savedVerbs } = await pool.query(
      `SELECT DISTINCT word, lemma
       FROM saved_words
       WHERE user_id = $1 AND target_language = $2
         AND part_of_speech ILIKE '%verb%'
       ORDER BY created_at DESC LIMIT 30`,
      [req.userId, target_language],
    );

    const prompt = buildConjugationPrompt({
      nativeLang: native_language,
      targetLang: target_language,
      cefrLevel: cefr_level,
      count,
      savedVerbs,
    });

    const raw = await callGemini(prompt, {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 4000,
      responseMimeType: 'application/json',
    });

    const problems = JSON.parse(raw);

    if (!Array.isArray(problems) || problems.length === 0) {
      logger.error('Gemini returned invalid conjugation format: %s', raw.slice(0, 500));
      return res.status(500).json({ error: 'Failed to generate conjugation drill' });
    }

    return res.json({ problems });
  } catch (err) {
    req.log.error({ err }, 'Error generating conjugation drill');
    return res.status(500).json({ error: 'Failed to generate conjugation drill' });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGenerationPrompt({ transcriptText, savedWordsContext, nativeLang, targetLang, cefrLevel, count }) {
  const cefrNote = cefrLevel ? `The student's proficiency level is ${cefrLevel}.` : '';

  let contextBlock = '';
  if (transcriptText) {
    contextBlock += `\nVideo transcript (in ${targetLang}):\n"""\n${transcriptText.slice(0, 3000)}\n"""\n`;
  }
  if (savedWordsContext) {
    contextBlock += `\nStudent's saved vocabulary words:\n${savedWordsContext}\n`;
  }

  return `You are a language quiz generator for a ${targetLang} learner whose native language is ${nativeLang}. ${cefrNote}

Generate exactly ${count} practice questions as a JSON array. Mix these question types:

1. "conjugation" — Give a verb infinitive and ask for a specific conjugation (tense + person). input_mode must be "free_type".
2. "grammar" — Give a phrase in ${nativeLang} and ask the student to produce it in ${targetLang}. Use input_mode "word_bank" for simpler questions (provide distractors array with the correct words plus 2-4 extra words, all shuffled) and "free_type" for harder ones.
3. "translation" — Give a sentence in ${targetLang} and ask the student to translate it to ${nativeLang}. input_mode must be "free_type".
${contextBlock}
For questions based on saved words, include the saved_word_id from the bracketed [id:...] above. Otherwise set saved_word_id to null.

Each question object must have exactly these fields:
- "type": "conjugation" | "grammar" | "translation"
- "prompt": the question text shown to the student
- "expected": the correct answer
- "input_mode": "word_bank" | "free_type"
- "distractors": array of words for word_bank mode (include correct answer words + extras, shuffled). Empty array for free_type.
- "hint": a short hint (optional, can be empty string)
- "saved_word_id": UUID string or null

Respond with ONLY the JSON array, no other text.`;
}

function buildConjugationPrompt({ nativeLang, targetLang, cefrLevel, count, savedVerbs }) {
  const cefrNote = cefrLevel ? `The student's level is ${cefrLevel}.` : '';

  let verbContext = '';
  if (savedVerbs.length > 0) {
    const verbs = savedVerbs.map((v) => v.lemma || v.word).join(', ');
    verbContext = `\nInclude some of these verbs the student is learning: ${verbs}\nAlso include common verbs for variety.\n`;
  }

  return `You are a conjugation drill generator for a ${targetLang} learner whose native language is ${nativeLang}. ${cefrNote}

Generate exactly ${count} conjugation problems as a JSON array. Each object must have:
- "infinitive": the verb infinitive in ${targetLang}
- "tense": tense name in ${nativeLang} (e.g. "present", "past", "future")
- "tense_target": tense name in ${targetLang}
- "pronoun": subject pronoun in ${targetLang} (e.g. "yo", "je", "ich")
- "expected": the correct conjugated verb form (just the verb, not the pronoun)

Rules:
- Use tenses appropriate for the student's level
- Mix different pronouns and tenses
- Include common irregular verbs
- Each "expected" must be exactly one correct form (the most standard form)
- Do NOT include the pronoun in "expected", only the conjugated verb
${verbContext}
Respond with ONLY the JSON array, no other text.`;
}

async function validateWithAI(userAnswer, expectedAnswer, questionType, prompt) {
  const validationPrompt = `You are a language learning answer validator. Compare the student's answer to the expected answer.

Question: ${prompt}
Expected answer: ${expectedAnswer}
Student's answer: ${userAnswer}
Question type: ${questionType}

Accept the answer as correct if it:
- Is semantically equivalent to the expected answer
- Uses acceptable alternate translations or phrasings
- Has only minor spelling/accent errors that don't change meaning

Respond with ONLY a JSON object: {"is_correct": true/false, "feedback": "brief explanation"}`;

  const raw = await callGemini(validationPrompt, {
    thinkingConfig: { thinkingBudget: 0 },
    maxOutputTokens: 200,
    responseMimeType: 'application/json',
  });

  return JSON.parse(raw);
}

export default router;
