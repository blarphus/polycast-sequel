import crypto from 'crypto';
import pool from '../db.js';
import redisClient from '../redis.js';
import { callGemini } from '../lib/gemini.js';

const MAX_TARGET_SENTENCE_WORDS = 16;
const MIN_TARGET_SENTENCE_WORDS = 4;

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function cleanSentenceCandidate(text) {
  const normalized = normalizeWhitespace(text)
    .replace(/^>>\s*/g, '')
    .replace(/\s+[—-]\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  if (/(copyright|all rights reserved|latest news|globo communication|participations s\\.a\\.?|terms of use|privacy policy)/i.test(normalized)) {
    return null;
  }
  if (/days$/i.test(normalized)) return null;
  if (normalized.includes('  ')) return null;
  if (/^[[({]/.test(normalized)) return null;
  if (/[*_=]{2,}/.test(normalized)) return null;
  const wordCount = normalized.split(/\s+/).length;
  if (wordCount < MIN_TARGET_SENTENCE_WORDS || wordCount > MAX_TARGET_SENTENCE_WORDS) return null;
  if (!/[.!?]$/.test(normalized)) return null;
  return normalized;
}

function splitIntoSentences(text) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map(cleanSentenceCandidate)
    .filter(Boolean);
}

function buildContentHash({ sourceType, sourceRefId, targetLanguage, nativeLanguage, sourceText }) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({ sourceType, sourceRefId, targetLanguage, nativeLanguage, sourceText }))
    .digest('hex');
}

async function fetchPendingWordListCandidates(userId, targetLanguage) {
  const { rows } = await pool.query(
    `SELECT sp.id AS post_id,
            sp.title,
            spw.id AS post_word_id,
            spw.word,
            spw.translation,
            spw.definition,
            spw.example_sentence
       FROM stream_posts sp
       JOIN stream_post_words spw ON spw.post_id = sp.id
      WHERE sp.type = 'word_list'
        AND sp.target_language = $2
        AND sp.teacher_id IN (
          SELECT DISTINCT ct.teacher_id
          FROM classroom_enrollments ce
          JOIN classroom_teachers ct ON ct.classroom_id = ce.classroom_id
          JOIN classrooms c ON c.id = ce.classroom_id
          WHERE ce.student_id = $1
            AND c.is_default_migrated = true
            AND c.archived_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM stream_word_list_completions swlc
           WHERE swlc.post_id = sp.id AND swlc.student_id = $1
        )
      ORDER BY sp.created_at DESC, spw.position ASC NULLS LAST
      LIMIT 20`,
    [userId, targetLanguage],
  );

  return rows
    .map((row) => ({
      sourceType: 'classwork',
      sourceRefId: row.post_word_id,
      sourceText: cleanSentenceCandidate(row.example_sentence),
      assignmentPriority: true,
      focusWords: row.word ? [row.word] : [],
    }))
    .filter((row) => row.sourceText);
}

async function fetchSavedWordCandidates(userId, targetLanguage) {
  const { rows } = await pool.query(
    `SELECT id, word, example_sentence, sentence_context
       FROM saved_words
      WHERE user_id = $1
        AND target_language = $2
      ORDER BY due_at ASC NULLS LAST, created_at DESC
      LIMIT 20`,
    [userId, targetLanguage],
  );

  return rows
    .flatMap((row) => {
      const sentence = cleanSentenceCandidate(row.example_sentence || row.sentence_context);
      if (!sentence) return [];
      return [{
        sourceType: 'dictionary',
        sourceRefId: row.id,
        sourceText: sentence,
        assignmentPriority: false,
        focusWords: row.word ? [row.word] : [],
      }];
    });
}

async function fetchVideoCandidates(targetLanguage) {
  const { rows } = await pool.query(
    `SELECT id, transcript
       FROM videos
      WHERE language = $1
        AND transcript IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 12`,
    [targetLanguage],
  );

  const candidates = [];
  for (const row of rows) {
    const transcript = Array.isArray(row.transcript) ? row.transcript : [];
    for (const segment of transcript) {
      const sentence = cleanSentenceCandidate(segment?.text);
      if (!sentence) continue;
      candidates.push({
        sourceType: 'video',
        sourceRefId: row.id,
        sourceText: sentence,
        assignmentPriority: false,
        focusWords: [],
      });
      if (candidates.length >= 24) break;
    }
    if (candidates.length >= 24) break;
  }
  return candidates;
}

async function fetchNewsCandidates(targetLanguage) {
  if (!redisClient.isReady) {
    return [];
  }

  const newsKey = `news8:${targetLanguage}`;
  const raw = await redisClient.get(newsKey);
  if (!raw) {
    return [];
  }

  const items = JSON.parse(raw);
  return items.flatMap((item, index) => {
    const sentence = splitIntoSentences(item.preview || '')[0];
    if (!sentence) return [];
    return [{
      sourceType: 'news',
      sourceRefId: item.link || String(index),
      sourceText: sentence,
      assignmentPriority: false,
      focusWords: [],
    }];
  }).slice(0, 12);
}

async function getOrCreateSentenceCard({
  sourceType,
  sourceRefId,
  targetLanguage,
  nativeLanguage,
  sourceText,
  assignmentPriority,
  focusWords,
}) {
  const contentHash = buildContentHash({
    sourceType,
    sourceRefId,
    targetLanguage,
    nativeLanguage,
    sourceText,
  });

  const { rows: existingRows } = await pool.query(
    `SELECT * FROM voice_sentence_cards WHERE content_hash = $1 LIMIT 1`,
    [contentHash],
  );
  if (existingRows[0]) return existingRows[0];

  const prompt = `You are preparing one spoken translation exercise.

Target language: ${targetLanguage}
Native language: ${nativeLanguage}

You will be given a target-language sentence. Return JSON only with:
- native_prompt: a natural ${nativeLanguage} sentence that preserves the meaning
- expected_target: the clean target-language sentence the learner should say
- difficulty: one of A1, A2, B1, B2, C1, C2
- focus_words: array of 0-4 important target-language words from the sentence

Rules:
- Keep the same meaning.
- Keep expected_target in ${targetLanguage}.
- Keep native_prompt in ${nativeLanguage}.
- Do not add commentary.
- focus_words must be simple strings.

Sentence:
${sourceText}`;

  const raw = await callGemini(prompt, {
    thinkingConfig: { thinkingBudget: 0 },
    maxOutputTokens: 400,
    responseMimeType: 'application/json',
  });

  const parsed = JSON.parse(raw);
  const expectedTarget = cleanSentenceCandidate(parsed.expected_target);
  if (!expectedTarget) {
    throw new Error('Voice practice card generation returned an invalid expected_target');
  }
  const nativePrompt = normalizeWhitespace(parsed.native_prompt);
  if (!nativePrompt) {
    throw new Error('Voice practice card generation returned an empty native_prompt');
  }
  const difficulty = typeof parsed.difficulty === 'string' ? parsed.difficulty : null;
  const normalizedFocusWords = Array.isArray(parsed.focus_words)
    ? parsed.focus_words.filter((word) => typeof word === 'string').slice(0, 4)
    : focusWords;

  const { rows: insertedRows } = await pool.query(
    `INSERT INTO voice_sentence_cards
      (source_type, source_ref_id, target_language, native_language, target_sentence,
       native_prompt, difficulty, focus_words_json, assignment_priority, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     ON CONFLICT (content_hash) DO UPDATE
       SET updated_at = NOW()
     RETURNING *`,
    [
      sourceType,
      sourceRefId,
      targetLanguage,
      nativeLanguage,
      expectedTarget,
      nativePrompt,
      difficulty,
      JSON.stringify(normalizedFocusWords),
      assignmentPriority,
      contentHash,
    ],
  );

  return insertedRows[0];
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.sourceType}:${candidate.sourceText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function buildVoicePracticeSentenceSet({
  userId,
  nativeLanguage,
  targetLanguage,
  count = 10,
}) {
  const [pending, saved, video, news] = await Promise.all([
    fetchPendingWordListCandidates(userId, targetLanguage),
    fetchSavedWordCandidates(userId, targetLanguage),
    fetchVideoCandidates(targetLanguage),
    fetchNewsCandidates(targetLanguage),
  ]);

  const deduped = dedupeCandidates([...pending, ...saved, ...video, ...news]);
  // Priority order: 1) assigned classwork, 2) saved dictionary words, 3) video/news
  const assigned = deduped.filter(c => c.assignmentPriority);
  const dictionary = deduped.filter(c => !c.assignmentPriority && c.sourceType === 'saved_word');
  const supplemental = deduped.filter(c => !c.assignmentPriority && c.sourceType !== 'saved_word');
  shuffleArray(dictionary);
  shuffleArray(supplemental);
  const orderedCandidates = [...assigned, ...dictionary, ...supplemental].slice(0, count * 3);

  if (orderedCandidates.length === 0) {
    throw new Error('No suitable sentences available for voice practice');
  }

  const cards = [];
  for (const candidate of orderedCandidates) {
    if (cards.length >= count) break;
    const card = await getOrCreateSentenceCard({
      ...candidate,
      nativeLanguage,
      targetLanguage,
    });
    cards.push(card);
  }

  if (cards.length === 0) {
    throw new Error('Failed to prepare sentence cards for voice practice');
  }

  return cards.map((card) => ({
    id: card.id,
    native_prompt: card.native_prompt,
    expected_target: card.target_sentence,
    difficulty: card.difficulty,
    source_type: card.source_type,
    source_ref_id: card.source_ref_id,
    focus_words: Array.isArray(card.focus_words_json) ? card.focus_words_json : [],
    assignment_priority: Boolean(card.assignment_priority),
  }));
}
