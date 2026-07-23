import crypto from 'crypto';
import logger from '../logger.js';
import {
  callGemini,
  GEMINI_FLASH_LITE_MODEL,
  GEMINI_FLASH_LITE_THINKING_LEVEL,
} from '../lib/gemini.js';
import { normalizeFallbackDiagnostic } from '../lib/fallbackDiagnostics.js';
import { awardLearningSessionXp, progressionSnapshot } from '../lib/progression.js';

const SESSION_SIZE = 8;
const CHOICE_COUNT = 4;
const BASE_KINDS = [
  'meaning_choice',
  'word_choice',
  'pair_match',
  'context_choice',
  'context_type',
  'listen_meaning',
  'listen_type',
  'meaning_choice',
];

function shuffle(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/[.!?]+$/g, '');
}

function parseForms(word) {
  const result = [word.word, word.lemma].filter(Boolean);
  if (word.forms) {
    try {
      const parsed = String(word.forms).trim().startsWith('[')
        ? JSON.parse(word.forms)
        : String(word.forms).split(',');
      if (Array.isArray(parsed)) result.push(...parsed);
    } catch (error) {
      logger.warn({
        event: 'legacy_word_forms_parser_used',
        operation: 'build-learning-session',
        wordId: word.id,
        err: error,
      }, 'Malformed JSON word forms used the legacy comma parser');
      result.push(...String(word.forms).split(','));
    }
  }
  return [...new Set(result.map(normalize).filter(Boolean))];
}

function blankSentence(sentence, word) {
  sentence = String(sentence || '').replaceAll('~', '').trim();
  if (!sentence) return null;
  const forms = parseForms(word).sort((a, b) => b.length - a.length);
  for (const form of forms) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^\\p{L}\\p{M}])(${escaped})(?=$|[^\\p{L}\\p{M}])`, 'iu');
    if (pattern.test(sentence)) return sentence.replace(pattern, (_, prefix) => `${prefix}_____`);
  }
  return null;
}

function sourceSentencesFor(word) {
  return [word.sentence_context, word.example_sentence]
    .map((sentence) => String(sentence || '').replaceAll('~', '').trim())
    .filter(Boolean);
}

function ensureFreshPracticeSentence(sentence, word) {
  const clean = String(sentence || '').replaceAll('~', '').trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > 220) return null;
  if (sourceSentencesFor(word).some((source) => normalize(source) === normalize(clean))) return null;
  return blankSentence(clean, word) ? clean : null;
}

function fallbackReason(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return message.replace(/\s+/g, ' ').trim().slice(0, 240) || 'Unknown error';
}

async function generatePracticeSentence(word, targetLanguage, nativeLanguage) {
  const sources = sourceSentencesFor(word);
  const basePrompt = `Write one NEW, short sentence for a vocabulary exercise in ${targetLanguage || 'the target language'}.

The learner must supply the exact saved word "${word.word}". Its ${nativeLanguage || 'native-language'} meaning is "${word.translation}"${word.definition ? ` and its definition is "${word.definition}"` : ''}.

Rules:
- Use the exact saved word "${word.word}" once. Do not inflect or replace it.
- Make a natural, standalone sentence of 6-14 words.
- Use an everyday situation familiar to a 14-year-old, such as school, home, friends, hobbies, travel, food, or sports.
- Keep the surrounding vocabulary at an A2-B1 level.
- Use correct spelling, punctuation, and accent marks throughout the sentence.
- Preserve every accent mark in the exact saved word.
- Do not quote, reuse, clip, or closely paraphrase any source sentence below.
- Do not include tildes, blanks, explanations, or markdown.

Source sentences to avoid:
${sources.length ? sources.map((source, index) => `${index + 1}. ${source}`).join('\n') : '(none)'}

Return only the sentence. Nothing else.`;

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt = attempt === 1
      ? basePrompt
      : `${basePrompt}\n\nRetry: the previous response was rejected. Follow every rule exactly.`;
    try {
      const raw = await callGemini(
        prompt,
        {
          thinkingConfig: { thinkingLevel: GEMINI_FLASH_LITE_THINKING_LEVEL },
          maxOutputTokens: 256,
        },
        GEMINI_FLASH_LITE_MODEL,
      );
      const sentence = ensureFreshPracticeSentence(raw, word);
      if (sentence) return sentence;
      lastError = new Error('Practice sentence generation returned an invalid or reused sentence');
    } catch (error) {
      lastError = error;
      if (!/Gemini returned no text content/.test(fallbackReason(error))) throw error;
    }
  }
  throw lastError;
}

function optionSet(words, correct, field) {
  const seen = new Set([normalize(correct[field])]);
  const distractors = [];
  for (const word of shuffle(words)) {
    const value = String(word[field] || '').trim();
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    distractors.push(value);
    if (distractors.length === CHOICE_COUNT - 1) break;
  }
  if (distractors.length < CHOICE_COUNT - 1) return null;
  const correctId = crypto.randomUUID();
  const options = shuffle([
    { id: correctId, text: correct[field] },
    ...distractors.map((text) => ({ id: crypto.randomUUID(), text })),
  ]);
  return { options, correctId };
}

function practiceLabels(nativeLanguage) {
  if (String(nativeLanguage || '').toLowerCase().split(/[-_]/)[0] === 'es') {
    return {
      listenMeaning: 'Escucha y elige el significado',
      chooseMeaning: 'Elige el significado',
      chooseWord: 'Elige la palabra',
      chooseMissing: 'Elige la palabra que falta',
      listenType: 'Escucha y escribe la palabra',
      typeMissing: 'Escribe la palabra que falta',
      matchWords: 'Relaciona las palabras',
    };
  }
  return {
    listenMeaning: 'Listen and choose the meaning',
    chooseMeaning: 'Choose the meaning',
    chooseWord: 'Choose the word',
    chooseMissing: 'Choose the missing word',
    listenType: 'Listen and type the word',
    typeMissing: 'Type the missing word',
    matchWords: 'Match the words',
  };
}

function makeExercise(kind, word, words, targetLanguage, generatedSentence = null, nativeLanguage = 'en') {
  const labels = practiceLabels(nativeLanguage);
  if (kind === 'meaning_choice' || kind === 'listen_meaning') {
    const choice = optionSet(words.filter((entry) => entry.id !== word.id), word, 'translation');
    if (!choice) return null;
    return {
      kind,
      savedWordId: word.id,
      prompt: kind === 'listen_meaning'
        ? { instruction: labels.listenMeaning, audioText: word.word, language: targetLanguage, options: choice.options }
        : { instruction: labels.chooseMeaning, word: word.word, options: choice.options },
      answer: { type: 'option', optionId: choice.correctId, label: word.translation },
    };
  }

  if (kind === 'word_choice') {
    const choice = optionSet(words.filter((entry) => entry.id !== word.id), word, 'word');
    if (!choice) return null;
    return {
      kind,
      savedWordId: word.id,
      prompt: { instruction: labels.chooseWord, meaning: word.translation || word.definition, options: choice.options },
      answer: { type: 'option', optionId: choice.correctId, label: word.word },
    };
  }

  if (kind === 'context_choice') {
    const sentence = blankSentence(generatedSentence, word);
    const choice = optionSet(words.filter((entry) => entry.id !== word.id), word, 'word');
    if (!sentence || !choice) return null;
    return {
      kind,
      savedWordId: word.id,
      prompt: {
        instruction: labels.chooseMissing,
        sentence,
        meaning: word.translation,
        imageUrl: word.image_url || null,
        options: choice.options,
      },
      answer: { type: 'option', optionId: choice.correctId, label: word.word },
    };
  }

  if (kind === 'context_type' || kind === 'listen_type') {
    const sentence = kind === 'context_type' ? blankSentence(generatedSentence, word) : null;
    if (kind === 'context_type' && !sentence) return null;
    return {
      kind,
      savedWordId: word.id,
      prompt: kind === 'listen_type'
        ? { instruction: labels.listenType, audioText: word.word, language: targetLanguage }
        : {
          instruction: labels.typeMissing,
          sentence,
          meaning: word.translation,
          imageUrl: word.image_url || null,
        },
      answer: { type: 'text', accepted: parseForms(word), label: word.word },
    };
  }

  if (kind === 'pair_match') {
    const pairWords = shuffle([word, ...words.filter((entry) => entry.id !== word.id)]).slice(0, CHOICE_COUNT);
    if (pairWords.length < CHOICE_COUNT) return null;
    const pairs = pairWords.map((entry) => ({
      leftId: crypto.randomUUID(),
      rightId: crypto.randomUUID(),
      word: entry.word,
      meaning: entry.translation,
    }));
    return {
      kind,
      savedWordId: word.id,
      prompt: {
        instruction: labels.matchWords,
        left: shuffle(pairs.map((pair) => ({ id: pair.leftId, text: pair.word }))),
        right: shuffle(pairs.map((pair) => ({ id: pair.rightId, text: pair.meaning }))),
      },
      answer: {
        type: 'pairs',
        pairs: pairs.map((pair) => ({ leftId: pair.leftId, rightId: pair.rightId })),
        label: pairs.map((pair) => `${pair.word} = ${pair.meaning}`).join(', '),
      },
    };
  }

  return null;
}

function publicExercise(row, total = SESSION_SIZE) {
  if (!row) return null;
  return {
    id: row.id,
    position: Number(row.position),
    total,
    kind: row.kind,
    prompt: row.prompt,
    retryOf: row.retry_of || null,
  };
}

async function userLanguages(db, userId) {
  const { rows } = await db.query('SELECT target_language, native_language FROM users WHERE id = $1', [userId]);
  return {
    targetLanguage: rows[0]?.target_language || null,
    nativeLanguage: rows[0]?.native_language || null,
  };
}

export async function createLearningSession(pool, userId, { kind, sourceVideoId = null, timeZone, correlationId }) {
  const { targetLanguage, nativeLanguage } = await userLanguages(pool, userId);
  if (kind === 'flashcards') {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM saved_words
        WHERE user_id = $1 AND target_language IS NOT DISTINCT FROM $2
          AND (due_at IS NULL OR due_at <= NOW() OR last_reviewed_at IS NULL)`,
      [userId, targetLanguage],
    );
    const dueCount = Number(rows[0]?.count) || 0;
    const totalItems = Math.min(5, dueCount);
    const created = await pool.query(
      `INSERT INTO learning_sessions (user_id, kind, target_language, total_items)
       VALUES ($1, 'flashcards', $2, $3) RETURNING *`,
      [userId, targetLanguage, totalItems],
    );
    return { session: created.rows[0], exercise: null, diagnostics: [], progression: await progressionSnapshot(pool, userId, timeZone) };
  }

  const diagnostics = [];
  const { rows: allWords } = await pool.query(
    `SELECT id, word, lemma, forms, translation, definition, sentence_context,
            example_sentence, image_url, target_language, last_reviewed_at
       FROM saved_words
      WHERE user_id = $1 AND target_language IS NOT DISTINCT FROM $2
        AND word <> '' AND translation <> ''
      ORDER BY last_reviewed_at DESC NULLS LAST, created_at DESC LIMIT 160`,
    [userId, targetLanguage],
  );
  const distinctWords = [];
  const seenWords = new Set();
  const seenMeanings = new Set();
  for (const word of allWords) {
    const wordKey = normalize(word.word);
    const meaningKey = normalize(word.translation);
    if (!wordKey || !meaningKey || seenWords.has(wordKey) || seenMeanings.has(meaningKey)) continue;
    seenWords.add(wordKey);
    seenMeanings.add(meaningKey);
    distinctWords.push(word);
  }
  if (distinctWords.length < CHOICE_COUNT) {
    const error = new Error(String(nativeLanguage || '').toLowerCase().startsWith('es')
      ? 'Guarda al menos cuatro palabras con significados distintos antes de comenzar la práctica.'
      : 'Save at least four words with distinct meanings before starting Practice.');
    error.status = 400;
    throw error;
  }

  let words = distinctWords;
  if (sourceVideoId) {
    const { rows: videos } = await pool.query('SELECT transcript FROM videos WHERE id = $1', [sourceVideoId]);
    const transcript = Array.isArray(videos[0]?.transcript)
      ? videos[0].transcript.map((segment) => segment.text || '').join(' ').toLocaleLowerCase()
      : '';
    const videoWords = distinctWords.filter((word) => parseForms(word).some((form) => transcript.includes(form)));
    if (videoWords.length >= CHOICE_COUNT) {
      const ids = new Set(videoWords.map((word) => word.id));
      words = [...videoWords, ...distinctWords.filter((word) => !ids.has(word.id))];
    } else {
      diagnostics.push({
        code: 'PRACTICE_VIDEO_POOL_FALLBACK',
        title: 'Practice fallback used',
        message: 'This video did not contain enough saved vocabulary, so the full saved-word pool was used.',
      });
    }
  }

  const candidates = shuffle(words);
  const contextWords = [3, 4].map((position) => candidates[position % candidates.length]);
  const generatedSentences = new Map();
  const sentenceResults = await Promise.allSettled(
    contextWords.map(async (word) => ({
      wordId: word.id,
      sentence: await generatePracticeSentence(word, targetLanguage, nativeLanguage),
    })),
  );
  let sentenceFallbackAdded = false;
  const sentenceFailures = [];
  for (let index = 0; index < sentenceResults.length; index += 1) {
    const result = sentenceResults[index];
    if (result.status === 'fulfilled') {
      generatedSentences.set(result.value.wordId, result.value.sentence);
      continue;
    }
    const reason = fallbackReason(result.reason);
    logger.warn('Practice sentence generation failed for "%s": %s', contextWords[index].word, reason);
    sentenceFailures.push(`“${contextWords[index].word}”: ${reason}`);
  }
  if (sentenceFailures.length) {
    sentenceFallbackAdded = true;
    diagnostics.push({
      code: 'PRACTICE_SENTENCE_FALLBACK',
      title: 'Practice fallback used',
      message: `A new practice sentence could not be generated, so that item was replaced with a meaning question. Reason: ${sentenceFailures.join(' · ')}`,
    });
  }
  if (contextWords.some((word) => !word.image_url)) {
    diagnostics.push({
      code: 'PRACTICE_IMAGE_UNAVAILABLE',
      title: 'Practice visual unavailable',
      message: 'One or more saved words do not have an illustration yet, so those prompts show the translation without an image.',
    });
  }
  const exercises = [];
  for (let position = 0; position < SESSION_SIZE; position += 1) {
    const preferredKind = BASE_KINDS[position];
    const word = candidates[position % candidates.length];
    let exercise = makeExercise(preferredKind, word, words, targetLanguage, generatedSentences.get(word.id), nativeLanguage);
    if (!exercise) {
      exercise = makeExercise(position % 2 ? 'word_choice' : 'meaning_choice', word, words, targetLanguage, null, nativeLanguage);
      if (!sentenceFallbackAdded && (preferredKind === 'context_choice' || preferredKind === 'context_type')) {
        sentenceFallbackAdded = true;
        diagnostics.push({
          code: 'PRACTICE_SENTENCE_FALLBACK',
          title: 'Practice fallback used',
          message: 'A new practice sentence could not be used, so that item was replaced with a meaning question. Reason: the generated sentence did not contain the expected saved word.',
        });
      }
    }
    if (exercise) exercises.push({ ...exercise, position });
  }
  if (exercises.length !== SESSION_SIZE) throw new Error('Could not build a complete vocabulary session');

  const normalizedDiagnostics = diagnostics.map((diagnostic) => normalizeFallbackDiagnostic({
    ...diagnostic,
    severity: diagnostic.severity || 'warning',
    source: 'server.practice',
    operation: 'create-vocabulary-session',
    correlationId,
    detail: diagnostic.detail || `sourceVideoId=${sourceVideoId || 'none'}`,
  }));
  for (const diagnostic of normalizedDiagnostics) {
    logger.warn({ fallback: diagnostic, userId }, 'Practice fallback path used');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: sessions } = await client.query(
      `INSERT INTO learning_sessions
        (user_id, kind, target_language, source_video_id, total_items, diagnostics)
       VALUES ($1, 'vocabulary', $2, $3, $4, $5::jsonb) RETURNING *`,
      [userId, targetLanguage, sourceVideoId, SESSION_SIZE, JSON.stringify(normalizedDiagnostics)],
    );
    const session = sessions[0];
    const created = [];
    for (const exercise of exercises) {
      const { rows } = await client.query(
        `INSERT INTO vocabulary_practice_exercises
          (session_id, position, kind, saved_word_id, prompt, answer)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb) RETURNING *`,
        [session.id, exercise.position, exercise.kind, exercise.savedWordId, JSON.stringify(exercise.prompt), JSON.stringify(exercise.answer)],
      );
      created.push(rows[0]);
    }
    await client.query('COMMIT');
    return {
      session,
      exercise: publicExercise(created[0]),
      diagnostics: normalizedDiagnostics,
      progression: await progressionSnapshot(pool, userId, timeZone),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function responseIsCorrect(answer, response) {
  if (answer.type === 'option') return response?.optionId === answer.optionId;
  if (answer.type === 'text') return answer.accepted.includes(normalize(response?.text));
  if (answer.type === 'pairs') {
    const expected = answer.pairs.map((pair) => `${pair.leftId}:${pair.rightId}`).sort();
    const actual = (response?.pairs || []).map((pair) => `${pair.leftId}:${pair.rightId}`).sort();
    return expected.length === actual.length && expected.every((pair, index) => pair === actual[index]);
  }
  return false;
}

export async function answerVocabularyExercise(pool, userId, sessionId, exerciseId, response) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: sessions } = await client.query(
      `SELECT * FROM learning_sessions
        WHERE id = $1 AND user_id = $2 AND kind = 'vocabulary' FOR UPDATE`,
      [sessionId, userId],
    );
    const session = sessions[0];
    if (!session || session.status !== 'active') {
      const error = new Error('Practice session is not active');
      error.status = 409;
      throw error;
    }
    const { rows: rows } = await client.query(
      `SELECT * FROM vocabulary_practice_exercises
        WHERE id = $1 AND session_id = $2 FOR UPDATE`,
      [exerciseId, sessionId],
    );
    const exercise = rows[0];
    if (!exercise) {
      const error = new Error('Exercise not found');
      error.status = 404;
      throw error;
    }
    if (exercise.answered_at) {
      const error = new Error('Exercise was already answered');
      error.status = 409;
      throw error;
    }
    const correct = responseIsCorrect(exercise.answer, response);
    await client.query(
      `UPDATE vocabulary_practice_exercises
          SET response = $3::jsonb, is_correct = $4, answered_at = NOW()
        WHERE id = $1 AND session_id = $2`,
      [exerciseId, sessionId, JSON.stringify(response || {}), correct],
    );
    await client.query(
      `UPDATE learning_sessions
          SET answered_count = answered_count + 1,
              correct_count = correct_count + $3
        WHERE id = $1 AND user_id = $2`,
      [sessionId, userId, correct ? 1 : 0],
    );

    if (!correct && Number(exercise.position) < SESSION_SIZE - 2 && !exercise.retry_of) {
      const { rows: wordRows } = await client.query('SELECT * FROM saved_words WHERE id = $1', [exercise.saved_word_id]);
      const { rows: poolWords } = await client.query(
        `SELECT * FROM saved_words WHERE user_id = $1 AND target_language IS NOT DISTINCT FROM $2
          AND word <> '' AND translation <> '' ORDER BY created_at DESC LIMIT 100`,
        [userId, session.target_language],
      );
      const retryKind = ['meaning_choice', 'listen_meaning'].includes(exercise.kind) ? 'word_choice' : 'meaning_choice';
      const retry = wordRows[0] && makeExercise(retryKind, wordRows[0], poolWords, session.target_language);
      if (retry) {
        const { rows: targets } = await client.query(
          `SELECT * FROM vocabulary_practice_exercises
            WHERE session_id = $1 AND answered_at IS NULL AND position > $2
            ORDER BY position DESC LIMIT 1 FOR UPDATE`,
          [sessionId, exercise.position],
        );
        if (targets[0]) {
          await client.query(
            `UPDATE vocabulary_practice_exercises
                SET kind = $2, saved_word_id = $3, prompt = $4::jsonb,
                    answer = $5::jsonb, retry_of = $6
              WHERE id = $1`,
            [targets[0].id, retry.kind, retry.savedWordId, JSON.stringify(retry.prompt), JSON.stringify(retry.answer), exercise.id],
          );
        }
      }
    }

    const { rows: nextRows } = await client.query(
      `SELECT * FROM vocabulary_practice_exercises
        WHERE session_id = $1 AND answered_at IS NULL ORDER BY position LIMIT 1`,
      [sessionId],
    );
    const { rows: updatedSessions } = await client.query('SELECT * FROM learning_sessions WHERE id = $1', [sessionId]);
    await client.query('COMMIT');
    return {
      correct,
      correctAnswer: exercise.answer.label || '',
      nextExercise: publicExercise(nextRows[0], Number(session.total_items)),
      session: updatedSessions[0],
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function recordFlashcardReview(db, userId, sessionId, correct) {
  if (!sessionId) return;
  await db.query(
    `UPDATE learning_sessions
        SET answered_count = LEAST(total_items, answered_count + 1),
            correct_count = correct_count + $3
      WHERE id = $1 AND user_id = $2 AND kind = 'flashcards' AND status = 'active'`,
    [sessionId, userId, correct ? 1 : 0],
  );
}

export async function completeLearningSession(pool, userId, sessionId, timeZone) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM learning_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [sessionId, userId],
    );
    const session = rows[0];
    if (!session) {
      const error = new Error('Learning session not found');
      error.status = 404;
      throw error;
    }
    if (session.status === 'active' && (session.total_items === 0 || session.answered_count < session.total_items)) {
      const error = new Error('Finish the session before completing it');
      error.status = 409;
      throw error;
    }
    let awardedXp = Number(session.awarded_xp) || 0;
    if (session.status !== 'completed') {
      awardedXp = await awardLearningSessionXp(client, userId, sessionId, timeZone);
      await client.query(
        `UPDATE learning_sessions
            SET status = 'completed', completed_at = NOW(), awarded_xp = $3
          WHERE id = $1 AND user_id = $2`,
        [sessionId, userId, awardedXp],
      );
    }
    await client.query('COMMIT');
    return { awardedXp, progression: await progressionSnapshot(pool, userId, timeZone) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export const __test = {
  blankSentence,
  ensureFreshPracticeSentence,
  fallbackReason,
  generatePracticeSentence,
  makeExercise,
  normalize,
  parseForms,
  responseIsCorrect,
};
