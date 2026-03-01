import { Router } from 'express';
import { authMiddleware, requireTeacher } from '../auth.js';
import pool from '../db.js';
import { enrichWord, fetchWordImage, callGemini, fetchWiktSenses, fetchWiktTranslations } from '../enrichWord.js';
import { applyEnglishFrequency } from '../lib/englishFrequency.js';

const router = Router();

// ---------------------------------------------------------------------------
// enrichAndInsertWords — shared helper for POST + PATCH word list routes
// ---------------------------------------------------------------------------

async function enrichAndInsertWords(client, postId, words, nativeLang, targetLang) {
  const enriched = await Promise.all(
    words.map(async (word, i) => {
      const wordStr = typeof word === 'string' ? word.trim() : word.word;
      if (typeof word === 'object' && word.translation) {
        return {
          word: wordStr, position: i,
          translation: word.translation,
          definition: word.definition ?? '',
          part_of_speech: word.part_of_speech ?? null,
          frequency: word.frequency ?? null,
          frequency_count: word.frequency_count ?? null,
          example_sentence: word.example_sentence ?? null,
          image_url: word.image_url ?? null,
          lemma: word.lemma ?? null,
          forms: word.forms ?? null,
          image_term: word.image_term ?? null,
        };
      }
      const result = await enrichWord(wordStr, '', nativeLang, targetLang);
      if (typeof word === 'object') {
        if (word.image_url !== undefined) result.image_url = word.image_url;
        if (word.definition !== undefined) result.definition = word.definition;
        if (word.example_sentence !== undefined) result.example_sentence = word.example_sentence;
      }
      return { word: wordStr, position: i, ...result };
    }),
  );

  for (const w of enriched) {
    await client.query(
      `INSERT INTO stream_post_words
         (post_id, word, translation, definition, part_of_speech, position,
          frequency, frequency_count, example_sentence, image_url, lemma, forms, image_term)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        postId, w.word, w.translation, w.definition, w.part_of_speech, w.position,
        w.frequency ?? null, w.frequency_count ?? null, w.example_sentence ?? null,
        w.image_url ?? null, w.lemma ?? null, w.forms ?? null, w.image_term ?? null,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/stream
// Teachers get their own posts + topics; students get posts + topics from teachers.
// ---------------------------------------------------------------------------

router.get('/api/stream', authMiddleware, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      'SELECT account_type FROM users WHERE id = $1',
      [req.userId],
    );
    if (userRows.length === 0) return res.status(401).json({ error: 'User not found' });
    const isTeacher = userRows[0].account_type === 'teacher';

    let posts;
    let topics;

    if (isTeacher) {
      const { rows: topicRows } = await pool.query(
        'SELECT * FROM stream_topics WHERE teacher_id = $1 ORDER BY position ASC',
        [req.userId],
      );
      topics = topicRows;

      const { rows } = await pool.query(
        `SELECT sp.*,
           COALESCE(wc.cnt, 0)::int AS word_count
         FROM stream_posts sp
         LEFT JOIN (
           SELECT post_id, COUNT(*) AS cnt FROM stream_post_words GROUP BY post_id
         ) wc ON wc.post_id = sp.id
         WHERE sp.teacher_id = $1
         ORDER BY sp.position ASC NULLS LAST, sp.created_at DESC`,
        [req.userId],
      );
      posts = rows;
    } else {
      const { rows: topicRows } = await pool.query(
        `SELECT st.*, COALESCE(u.display_name, u.username) AS teacher_name
         FROM stream_topics st
         JOIN users u ON u.id = st.teacher_id
         WHERE st.teacher_id IN (SELECT teacher_id FROM classroom_students WHERE student_id = $1)
         ORDER BY st.position ASC`,
        [req.userId],
      );
      topics = topicRows;

      const { rows } = await pool.query(
        `SELECT sp.*,
           COALESCE(wc.cnt, 0)::int AS word_count,
           u.display_name AS teacher_display_name,
           u.username AS teacher_username
         FROM stream_posts sp
         JOIN users u ON u.id = sp.teacher_id
         LEFT JOIN (
           SELECT post_id, COUNT(*) AS cnt FROM stream_post_words GROUP BY post_id
         ) wc ON wc.post_id = sp.id
         WHERE sp.teacher_id IN (
           SELECT teacher_id FROM classroom_students WHERE student_id = $1
         )
         ORDER BY sp.position ASC NULLS LAST, sp.created_at DESC`,
        [req.userId],
      );
      posts = rows.map((p) => ({
        ...p,
        teacher_name: p.teacher_display_name || p.teacher_username,
      }));
    }

    // Fetch words for all word_list posts in one query
    const wordListPostIds = posts.filter((p) => p.type === 'word_list').map((p) => p.id);
    let wordsByPostId = {};
    if (wordListPostIds.length > 0) {
      const { rows: wordRows } = await pool.query(
        `SELECT * FROM stream_post_words
         WHERE post_id = ANY($1)
         ORDER BY position ASC NULLS LAST, created_at ASC`,
        [wordListPostIds],
      );
      for (const w of wordRows) {
        if (!wordsByPostId[w.post_id]) wordsByPostId[w.post_id] = [];
        wordsByPostId[w.post_id].push(w);
      }
    }

    // For students: fetch known_word_ids and completed status
    let knownWordsByPostId = {};
    let completedPostIds = new Set();

    if (!isTeacher && wordListPostIds.length > 0) {
      const allWordIds = Object.values(wordsByPostId).flat().map((w) => w.id);
      if (allWordIds.length > 0) {
        const { rows: knownRows } = await pool.query(
          `SELECT post_word_id FROM stream_word_known
           WHERE student_id = $1 AND post_word_id = ANY($2)`,
          [req.userId, allWordIds],
        );
        const wordIdToPostId = {};
        for (const [postId, words] of Object.entries(wordsByPostId)) {
          for (const w of words) wordIdToPostId[w.id] = postId;
        }
        for (const row of knownRows) {
          const postId = wordIdToPostId[row.post_word_id];
          if (!knownWordsByPostId[postId]) knownWordsByPostId[postId] = [];
          knownWordsByPostId[postId].push(row.post_word_id);
        }
      }

      const { rows: completionRows } = await pool.query(
        `SELECT post_id FROM stream_word_list_completions
         WHERE student_id = $1 AND post_id = ANY($2)`,
        [req.userId, wordListPostIds],
      );
      for (const row of completionRows) completedPostIds.add(row.post_id);
    }

    const assembled = posts.map((p) => {
      const post = { ...p };
      if (p.type === 'word_list') {
        post.words = wordsByPostId[p.id] || [];
        if (!isTeacher) {
          post.known_word_ids = knownWordsByPostId[p.id] || [];
          post.completed = completedPostIds.has(p.id);
        }
      }
      return post;
    });

    return res.json({ topics, posts: assembled });
  } catch (err) {
    console.error('GET /api/stream error:', err);
    return res.status(500).json({ error: err.message || 'Failed to load stream' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream/pending — incomplete word lists for students
// ---------------------------------------------------------------------------

router.get('/api/stream/pending', authMiddleware, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      'SELECT account_type FROM users WHERE id = $1',
      [req.userId],
    );
    if (userRows.length === 0) return res.status(401).json({ error: 'User not found' });
    if (userRows[0].account_type === 'teacher') {
      return res.json({ count: 0, posts: [] });
    }

    const { rows } = await pool.query(
      `SELECT sp.id, sp.title, sp.created_at,
              COALESCE(wc.cnt, 0)::int AS word_count,
              COALESCE(u.display_name, u.username) AS teacher_name
       FROM stream_posts sp
       JOIN users u ON u.id = sp.teacher_id
       LEFT JOIN (
         SELECT post_id, COUNT(*) AS cnt FROM stream_post_words GROUP BY post_id
       ) wc ON wc.post_id = sp.id
       WHERE sp.type = 'word_list'
         AND sp.teacher_id IN (
           SELECT teacher_id FROM classroom_students WHERE student_id = $1
         )
         AND NOT EXISTS (
           SELECT 1 FROM stream_word_list_completions swlc
           WHERE swlc.post_id = sp.id AND swlc.student_id = $1
         )
       ORDER BY sp.created_at DESC`,
      [req.userId],
    );

    return res.json({ count: rows.length, posts: rows });
  } catch (err) {
    console.error('GET /api/stream/pending error:', err);
    return res.status(500).json({ error: err.message || 'Failed to load pending classwork' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/topics — create a topic (teacher only)
// ---------------------------------------------------------------------------

router.post('/api/stream/topics', authMiddleware, requireTeacher, async (req, res) => {
  const { title } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });

  try {
    const { rows: maxRows } = await pool.query(
      'SELECT COALESCE(MAX(position), -1) AS max_pos FROM stream_topics WHERE teacher_id = $1',
      [req.userId],
    );
    const nextPos = (maxRows[0].max_pos ?? -1) + 1;

    const { rows } = await pool.query(
      `INSERT INTO stream_topics (teacher_id, title, position)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.userId, title.trim(), nextPos],
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /api/stream/topics error:', err);
    return res.status(500).json({ error: err.message || 'Failed to create topic' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/stream/topics/:id — rename a topic (teacher only, must own it)
// ---------------------------------------------------------------------------

router.patch('/api/stream/topics/:id', authMiddleware, async (req, res) => {
  const { title } = req.body;
  try {
    const { rows: existing } = await pool.query(
      'SELECT * FROM stream_topics WHERE id = $1',
      [req.params.id],
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Topic not found' });
    if (existing[0].teacher_id !== req.userId) {
      return res.status(403).json({ error: 'Not your topic' });
    }

    const { rows } = await pool.query(
      `UPDATE stream_topics SET title = COALESCE($1, title) WHERE id = $2 RETURNING *`,
      [title !== undefined ? title.trim() : null, req.params.id],
    );
    return res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /api/stream/topics/:id error:', err);
    return res.status(500).json({ error: err.message || 'Failed to update topic' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/stream/topics/:id — delete a topic; posts get topic_id = NULL
// ---------------------------------------------------------------------------

router.delete('/api/stream/topics/:id', authMiddleware, async (req, res) => {
  try {
    const { rows: existing } = await pool.query(
      'SELECT teacher_id FROM stream_topics WHERE id = $1',
      [req.params.id],
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Topic not found' });
    if (existing[0].teacher_id !== req.userId) {
      return res.status(403).json({ error: 'Not your topic' });
    }

    await pool.query('DELETE FROM stream_topics WHERE id = $1', [req.params.id]);
    return res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/stream/topics/:id error:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete topic' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/stream/reorder — bulk reorder posts and/or topics (teacher only)
// ---------------------------------------------------------------------------

router.patch('/api/stream/reorder', authMiddleware, requireTeacher, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const item of items) {
        if (item.kind === 'post') {
          const { rows } = await client.query(
            'SELECT teacher_id FROM stream_posts WHERE id = $1',
            [item.id],
          );
          if (rows.length === 0 || rows[0].teacher_id !== req.userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Not your post: ' + item.id });
          }
          await client.query(
            `UPDATE stream_posts SET position = $1, topic_id = $2, updated_at = NOW() WHERE id = $3`,
            [item.position, item.topic_id !== undefined ? item.topic_id : null, item.id],
          );
        } else if (item.kind === 'topic') {
          const { rows } = await client.query(
            'SELECT teacher_id FROM stream_topics WHERE id = $1',
            [item.id],
          );
          if (rows.length === 0 || rows[0].teacher_id !== req.userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Not your topic: ' + item.id });
          }
          await client.query(
            `UPDATE stream_topics SET position = $1 WHERE id = $2`,
            [item.position, item.id],
          );
        }
      }

      await client.query('COMMIT');
      return res.status(204).end();
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('PATCH /api/stream/reorder error:', err);
    return res.status(500).json({ error: err.message || 'Failed to reorder' });
  }
});

// ---------------------------------------------------------------------------
// lookupWordForPost — quick translation/definition preview for word list creation
// ---------------------------------------------------------------------------

async function lookupWordForPost(word, nativeLang, targetLang) {
  const prompt = `Translate and define the ${targetLang || 'foreign'} word "${word}". The user's native language is ${nativeLang}.

Return a JSON object with exactly these keys:
{"translation":"...","definition":"...","part_of_speech":"...","example_sentence":"...","frequency":0,"lemma":"...","forms":"...","image_term":"..."}

- translation: standard ${nativeLang} translation of "${word}", 1-3 words max
- definition: what this word means in ${nativeLang}, 12 words max, no markdown
- part_of_speech: one of noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle
- example_sentence: a short sentence in ${targetLang} using "${word}", wrap the word with tildes like ~word~, 15 words max
- frequency: integer 1-10 how common this word is (1-2 rare, 3-4 uncommon, 5-6 moderate, 7-8 common everyday, 9-10 essential top-500)
- lemma: dictionary/base form (infinitive for verbs, singular for nouns). Same as word if already base form. Empty string for particles/prepositions.
- forms: comma-separated inflected forms of the lemma (e.g. "run, runs, ran, running"). Empty string if uninflected.
- image_term: a 1-4 word English phrase describing a concrete, photographable subject that captures THIS SPECIFIC meaning of the word. Works as a stock-photo search query. Concrete nouns → the object itself. Abstract words → a vivid scene or tangible symbol. Do NOT repeat the word itself unless it is already a concrete noun.

Respond with ONLY the JSON object, no other text.`;

  const raw = await callGemini(prompt, { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 400, responseMimeType: 'application/json' });
  const parsed = JSON.parse(raw);
  const image_url = await fetchWordImage(parsed.image_term || word);

  const rawFrequency = typeof parsed.frequency === 'number' ? parsed.frequency : null;
  const { frequency, frequency_count } = applyEnglishFrequency(word, targetLang, rawFrequency);

  // Normalize forms
  let forms = null;
  if (parsed.forms) {
    const formsList = parsed.forms.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (formsList.length > 1) forms = JSON.stringify(formsList);
  }

  // Normalize lemma
  let lemma = parsed.lemma?.trim() || null;
  if (lemma && parsed.part_of_speech === 'verb' && (targetLang === 'en' || targetLang?.startsWith('en-'))) {
    if (!lemma.startsWith('to ')) lemma = 'to ' + lemma;
  }

  return {
    translation: parsed.translation || '',
    definition: parsed.definition || '',
    part_of_speech: parsed.part_of_speech || null,
    example_sentence: parsed.example_sentence || null,
    image_url,
    frequency,
    frequency_count,
    lemma,
    forms,
    image_term: parsed.image_term || word,
  };
}

// ---------------------------------------------------------------------------
// POST /api/stream/words/example — generate a single example sentence (teacher)
// ---------------------------------------------------------------------------

router.post('/api/stream/words/example', authMiddleware, requireTeacher, async (req, res) => {
  const { word, targetLang, definition } = req.body;
  if (!word) return res.status(400).json({ error: 'word is required' });
  if (!targetLang) return res.status(400).json({ error: 'targetLang is required' });

  try {
    const defHint = definition ? ` with the meaning "${definition}"` : '';
    const prompt = `Write a short example sentence in ${targetLang} using the word "${word}"${defHint}. Wrap the word with tildes like ~word~. 15 words max.

Return a JSON object: {"example_sentence":"..."}

Respond with ONLY the JSON object, no other text.`;

    const raw = await callGemini(prompt, { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 100, responseMimeType: 'application/json' });
    const parsed = JSON.parse(raw);
    return res.json({ example_sentence: parsed.example_sentence || null });
  } catch (err) {
    console.error('POST /api/stream/words/example error:', err);
    return res.status(500).json({ error: err.message || 'Example sentence generation failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/words/batch-translate — translate pre-enriched template words
// ---------------------------------------------------------------------------

router.post('/api/stream/words/batch-translate', authMiddleware, requireTeacher, async (req, res) => {
  const { words, nativeLang, allWords } = req.body;

  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'words array is required' });
  }
  if (!nativeLang) return res.status(400).json({ error: 'nativeLang is required' });

  try {
    // 1. Fetch translations from English Wiktionary for each word
    const translationsPerWord = await Promise.all(
      words.map(async (w) => {
        try {
          return await fetchWiktTranslations(w.word, nativeLang);
        } catch (err) {
          console.error(`Wikt translations failed for "${w.word}":`, err);
          return [];
        }
      }),
    );

    // 2. For words with NO senses at all, fall back to native-edition glosses
    const needsFallback = [];
    for (let i = 0; i < words.length; i++) {
      if (translationsPerWord[i].length === 0) needsFallback.push(i);
    }

    const fallbackSensesMap = {};
    if (needsFallback.length > 0) {
      const fallbackResults = await Promise.all(
        needsFallback.map(async (i) => {
          try {
            return await fetchWiktSenses(words[i].word, 'en', nativeLang);
          } catch (err) {
            console.error(`Wikt fallback failed for "${words[i].word}":`, err);
            return [];
          }
        }),
      );
      for (let j = 0; j < needsFallback.length; j++) {
        fallbackSensesMap[needsFallback[j]] = fallbackResults[j];
      }
    }

    // 3. Build results + collect ambiguous words for Gemini
    const results = new Array(words.length).fill(null);
    const ambiguous = [];

    for (let i = 0; i < words.length; i++) {
      const txns = translationsPerWord[i];
      const withWords = txns.filter(t => t.words.length > 0);

      if (withWords.length === 1) {
        // Single sense with native translation — use directly
        results[i] = { translation: withWords[0].words[0], definition: withWords[0].sense };
      } else if (withWords.length > 1) {
        // Multiple senses with native translations — Gemini picks sense
        ambiguous.push({
          index: i, word: words[i].word, definition: words[i].definition,
          senses: withWords.map(t => ({
            label: `[${t.pos}] ${t.sense} → ${t.words.join(', ')}`,
            translation: t.words[0],
            definition: t.sense,
          })),
        });
      } else if (txns.length > 0) {
        // Senses exist but no native translations — Gemini picks sense AND translates
        ambiguous.push({
          index: i, word: words[i].word, definition: words[i].definition,
          needsTranslation: true,
          senses: txns.map(t => ({
            label: `[${t.pos}] ${t.sense}`,
            translation: null,
            definition: t.sense,
          })),
        });
      } else {
        // No senses at all — use fallback glosses
        const senses = fallbackSensesMap[i] || [];
        if (senses.length === 1) {
          results[i] = { translation: senses[0].gloss, definition: senses[0].gloss };
        } else if (senses.length > 1) {
          ambiguous.push({
            index: i, word: words[i].word, definition: words[i].definition,
            senses: senses.map(s => ({
              label: `[${s.pos}] ${s.gloss}`,
              translation: s.gloss,
              definition: s.gloss,
            })),
          });
        }
        // senses.length === 0 → results[i] stays null
      }
    }

    // 4. If there are ambiguous words, use ONE Gemini call to disambiguate
    //    (and translate entries that have no native-language words)
    const unitWordList = Array.isArray(allWords) && allWords.length > 0
      ? allWords
      : words.map(w => w.word);

    if (ambiguous.length > 0) {
      const anyNeedTranslation = ambiguous.some(a => a.needsTranslation);

      const wordEntries = ambiguous.map((a, entryIdx) => {
        const senseList = a.senses.map((s, si) => `  ${si}: ${s.label}`).join('\n');
        const tag = a.needsTranslation ? ' [TRANSLATE]' : '';
        return `WORD ${entryIdx}: "${a.word}" (English definition: "${a.definition}")${tag}\n${senseList}`;
      }).join('\n\n');

      const translateInstruction = anyNeedTranslation
        ? `\nFor words marked [TRANSLATE], no dictionary translations exist for ${nativeLang} — also provide a concise ${nativeLang} translation (1-3 words) in the "translation" field.\nFor other words, omit the "translation" field.`
        : '';

      const responseFormat = anyNeedTranslation
        ? '{"sense_index": <int>} or {"sense_index": <int>, "translation": "..."} for [TRANSLATE] words'
        : '{"sense_index": <int>}';

      const prompt = `You are a vocabulary-list translation assistant.

A teacher is translating an English vocabulary unit into ${nativeLang}.
The unit contains these words: ${unitWordList.join(', ')}

For each word below, pick the dictionary sense index that best matches the word's intended meaning in this thematic unit.
${translateInstruction}

${wordEntries}

Respond with ONLY a JSON array of objects, one per word above, in order:
[${responseFormat}, ...]

Each sense_index must be a valid index from the senses listed for that word.`;

      try {
        const raw = await callGemini(prompt, {
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 400,
          responseMimeType: 'application/json',
        });
        const picks = JSON.parse(raw);

        for (let j = 0; j < ambiguous.length; j++) {
          const a = ambiguous[j];
          const pick = picks[j];
          const si = typeof pick?.sense_index === 'number' ? pick.sense_index : 0;
          const sense = a.senses[si] || a.senses[0];
          const translation = sense.translation || pick?.translation || '';
          results[a.index] = { translation, definition: sense.definition };
        }
      } catch (err) {
        console.error('Gemini disambiguation failed, falling back to first sense:', err);
        for (const a of ambiguous) {
          const sense = a.senses[0];
          results[a.index] = sense.translation
            ? { translation: sense.translation, definition: sense.definition }
            : null;
        }
      }
    }

    return res.json({ translations: results });
  } catch (err) {
    console.error('POST /api/stream/words/batch-translate error:', err);
    return res.status(500).json({ error: err.message || 'Batch translation failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/words/lookup — preview word translations (teacher only)
// ---------------------------------------------------------------------------

router.post('/api/stream/words/lookup', authMiddleware, requireTeacher, async (req, res) => {
  const { words, nativeLang, targetLang } = req.body;

  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'words array is required' });
  }
  if (!nativeLang) return res.status(400).json({ error: 'nativeLang is required' });
  if (!targetLang) return res.status(400).json({ error: 'targetLang is required' });

  try {
    const results = await Promise.all(
      words.map(async (word, i) => {
        const enriched = await lookupWordForPost(word.trim(), nativeLang, targetLang);
        return { id: `preview-${i}`, word: word.trim(), position: i, ...enriched };
      }),
    );

    return res.json({ words: results });
  } catch (err) {
    console.error('POST /api/stream/words/lookup error:', err);
    return res.status(500).json({ error: err.message || 'Word lookup failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/posts — create a post (teacher only)
// ---------------------------------------------------------------------------

router.post('/api/stream/posts', authMiddleware, requireTeacher, async (req, res) => {
  const { type, title, body, attachments, words, target_language, lesson_items, topic_id } = req.body;

  if (!type || !['material', 'word_list', 'lesson'].includes(type)) {
    return res.status(400).json({ error: 'type must be material, word_list, or lesson' });
  }

  try {
    const user = req.userRecord;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: postRows } = await client.query(
        `INSERT INTO stream_posts (teacher_id, type, title, body, attachments, target_language, lesson_items, topic_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          req.userId,
          type,
          title || null,
          body || null,
          JSON.stringify(attachments || []),
          target_language || user.target_language || null,
          JSON.stringify(lesson_items || []),
          topic_id || null,
        ],
      );
      const post = postRows[0];

      if (type === 'word_list' && Array.isArray(words) && words.length > 0) {
        const nativeLang = user.native_language;
        const targetLang = target_language || user.target_language;

        if (!nativeLang) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Teacher must set native_language in settings before creating word lists' });
        }

        await enrichAndInsertWords(client, post.id, words, nativeLang, targetLang);
      }

      await client.query('COMMIT');

      const { rows: wordRows } = await pool.query(
        'SELECT * FROM stream_post_words WHERE post_id = $1 ORDER BY position ASC',
        [post.id],
      );

      return res.status(201).json({ ...post, words: wordRows });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('POST /api/stream/posts error:', err);
    return res.status(500).json({ error: err.message || 'Failed to create post' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream/posts/:id/enrich — SSE: enrich words that have no translation
// ---------------------------------------------------------------------------

router.get('/api/stream/posts/:id/enrich', authMiddleware, async (req, res) => {
  const postId = req.params.id;

  const { rows } = await pool.query(
    'SELECT teacher_id, target_language FROM stream_posts WHERE id = $1',
    [postId],
  );
  if (!rows[0] || rows[0].teacher_id !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { rows: userRows } = await pool.query(
    'SELECT native_language FROM users WHERE id = $1', [req.userId],
  );
  const nativeLang = userRows[0]?.native_language;
  const targetLang = rows[0].target_language;

  const { rows: wordRows } = await pool.query(
    `SELECT id, word FROM stream_post_words
     WHERE post_id = $1 AND (translation IS NULL OR translation = '')
     ORDER BY position ASC`,
    [postId],
  );

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  for (const w of wordRows) {
    try {
      const result = await enrichWord(w.word, '', nativeLang, targetLang);
      await pool.query(
        `UPDATE stream_post_words
         SET translation=$1, definition=$2, part_of_speech=$3, frequency=$4,
             frequency_count=$5, example_sentence=$6, image_url=$7, lemma=$8, forms=$9,
             image_term=$10
         WHERE id=$11`,
        [result.translation, result.definition, result.part_of_speech,
         result.frequency, result.frequency_count, result.example_sentence,
         result.image_url, result.lemma, result.forms, result.image_term, w.id],
      );
      res.write(`data: ${JSON.stringify({ word_id: w.id, ...result })}\n\n`);
    } catch (err) {
      console.error(`enrichPostStream: failed to enrich word ${w.id}:`, err);
      res.write(`data: ${JSON.stringify({ word_id: w.id, error: true })}\n\n`);
    }
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

// ---------------------------------------------------------------------------
// PATCH /api/stream/posts/:id — edit a post (teacher only, must own it)
// ---------------------------------------------------------------------------

router.patch('/api/stream/posts/:id', authMiddleware, async (req, res) => {
  const { title, body, attachments, lesson_items, words, target_language } = req.body;
  const topicIdInBody = Object.prototype.hasOwnProperty.call(req.body, 'topic_id');
  const topicId = req.body.topic_id;

  try {
    const { rows: existing } = await pool.query(
      'SELECT * FROM stream_posts WHERE id = $1',
      [req.params.id],
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Post not found' });
    if (existing[0].teacher_id !== req.userId) {
      return res.status(403).json({ error: 'Not your post' });
    }

    // --- Word list edit: delete old words + re-insert in a transaction ---
    if (Array.isArray(words) && existing[0].type === 'word_list') {
      if (words.length === 0) {
        return res.status(400).json({ error: 'Word list must have at least one word' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Update post row (title + target_language + topic)
        const updateParams = [
          title !== undefined ? title : existing[0].title,
          target_language !== undefined ? target_language : existing[0].target_language,
        ];
        let updateQuery = `UPDATE stream_posts
           SET title = $1, target_language = $2, updated_at = NOW()`;
        if (topicIdInBody) {
          updateParams.push(topicId);
          updateQuery += `, topic_id = $${updateParams.length}`;
        }
        updateParams.push(req.params.id);
        updateQuery += ` WHERE id = $${updateParams.length} RETURNING *`;
        const { rows: postRows } = await client.query(updateQuery, updateParams);
        const post = postRows[0];

        // Reset student completions (word list changed)
        await client.query(
          'DELETE FROM stream_word_list_completions WHERE post_id = $1',
          [req.params.id],
        );

        // Delete old words (cascades to stream_word_known)
        await client.query(
          'DELETE FROM stream_post_words WHERE post_id = $1',
          [req.params.id],
        );

        // Insert new words
        const { rows: userRows } = await client.query(
          'SELECT native_language FROM users WHERE id = $1', [req.userId],
        );
        const nativeLang = userRows[0]?.native_language;
        const targetLang = target_language || existing[0].target_language;

        await enrichAndInsertWords(client, req.params.id, words, nativeLang, targetLang);

        await client.query('COMMIT');

        const { rows: wordRows } = await pool.query(
          'SELECT * FROM stream_post_words WHERE post_id = $1 ORDER BY position ASC',
          [req.params.id],
        );

        return res.json({ ...post, words: wordRows, word_count: wordRows.length });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // --- Standard (non-word-list) update ---
    const params = [
      title !== undefined ? title : null,
      body !== undefined ? body : null,
      attachments !== undefined ? JSON.stringify(attachments) : null,
      lesson_items !== undefined ? JSON.stringify(lesson_items) : null,
    ];

    let query = `UPDATE stream_posts
       SET title = COALESCE($1, title),
           body = COALESCE($2, body),
           attachments = COALESCE($3, attachments),
           lesson_items = COALESCE($4, lesson_items),
           updated_at = NOW()`;

    if (target_language !== undefined) {
      params.push(target_language);
      query += `, target_language = $${params.length}`;
    }

    if (topicIdInBody) {
      params.push(topicId);
      query += `, topic_id = $${params.length}`;
    }

    params.push(req.params.id);
    query += ` WHERE id = $${params.length} RETURNING *`;

    const { rows } = await pool.query(query, params);
    return res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /api/stream/posts/:id error:', err);
    return res.status(500).json({ error: err.message || 'Failed to update post' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/stream/posts/:id — delete a post (teacher only, must own it)
// ---------------------------------------------------------------------------

router.delete('/api/stream/posts/:id', authMiddleware, async (req, res) => {
  try {
    const { rows: existing } = await pool.query(
      'SELECT teacher_id FROM stream_posts WHERE id = $1',
      [req.params.id],
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Post not found' });
    if (existing[0].teacher_id !== req.userId) {
      return res.status(403).json({ error: 'Not your post' });
    }

    await pool.query('DELETE FROM stream_posts WHERE id = $1', [req.params.id]);
    return res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/stream/posts/:id error:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete post' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/posts/:postId/known — toggle known word (student)
// ---------------------------------------------------------------------------

router.post('/api/stream/posts/:postId/known', authMiddleware, async (req, res) => {
  const { postWordId, known } = req.body;

  if (!postWordId || known === undefined) {
    return res.status(400).json({ error: 'postWordId and known are required' });
  }

  try {
    const { rows: postRows } = await pool.query(
      'SELECT teacher_id FROM stream_posts WHERE id = $1',
      [req.params.postId],
    );
    if (postRows.length === 0) return res.status(404).json({ error: 'Post not found' });

    const { rows: enrollRows } = await pool.query(
      'SELECT 1 FROM classroom_students WHERE teacher_id = $1 AND student_id = $2',
      [postRows[0].teacher_id, req.userId],
    );
    if (enrollRows.length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this classroom' });
    }

    if (known) {
      await pool.query(
        `INSERT INTO stream_word_known (student_id, post_word_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [req.userId, postWordId],
      );
    } else {
      await pool.query(
        'DELETE FROM stream_word_known WHERE student_id = $1 AND post_word_id = $2',
        [req.userId, postWordId],
      );
    }

    return res.status(204).end();
  } catch (err) {
    console.error('POST /api/stream/posts/:postId/known error:', err);
    return res.status(500).json({ error: err.message || 'Failed to update known status' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stream/posts/:postId/add-to-dictionary — student adds unknown words
// ---------------------------------------------------------------------------

router.post('/api/stream/posts/:postId/add-to-dictionary', authMiddleware, async (req, res) => {
  try {
    const { rows: postRows } = await pool.query(
      'SELECT * FROM stream_posts WHERE id = $1',
      [req.params.postId],
    );
    if (postRows.length === 0) return res.status(404).json({ error: 'Post not found' });
    if (postRows[0].type !== 'word_list') {
      return res.status(400).json({ error: 'Post is not a word list' });
    }

    const { rows: enrollRows } = await pool.query(
      'SELECT 1 FROM classroom_students WHERE teacher_id = $1 AND student_id = $2',
      [postRows[0].teacher_id, req.userId],
    );
    if (enrollRows.length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this classroom' });
    }

    const { rows: wordsToAdd } = await pool.query(
      `SELECT spw.*
       FROM stream_post_words spw
       WHERE spw.post_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM stream_word_known swk
           WHERE swk.post_word_id = spw.id AND swk.student_id = $2
         )`,
      [req.params.postId, req.userId],
    );

    const { rows: studentRows } = await pool.query(
      'SELECT target_language FROM users WHERE id = $1',
      [req.userId],
    );
    const targetLanguage = postRows[0].target_language || studentRows[0]?.target_language || null;

    let added = 0;
    let skipped = 0;

    for (const w of wordsToAdd) {
      const imageUrl = w.image_url !== null ? w.image_url : await fetchWordImage(w.word);
      const { rowCount } = await pool.query(
        `INSERT INTO saved_words
           (user_id, word, translation, definition, target_language, part_of_speech,
            frequency, frequency_count, example_sentence, image_url, lemma, forms, priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
         ON CONFLICT DO NOTHING`,
        [
          req.userId, w.word, w.translation, w.definition, targetLanguage, w.part_of_speech,
          w.frequency ?? null, w.frequency_count ?? null, w.example_sentence ?? null,
          imageUrl, w.lemma ?? null, w.forms ?? null,
        ],
      );
      if (rowCount > 0) {
        added++;
      } else {
        skipped++;
      }
    }

    await pool.query(
      `INSERT INTO stream_word_list_completions (student_id, post_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.userId, req.params.postId],
    );

    return res.json({ added, skipped });
  } catch (err) {
    console.error('POST /api/stream/posts/:postId/add-to-dictionary error:', err);
    return res.status(500).json({ error: err.message || 'Failed to add words to dictionary' });
  }
});

export default router;
