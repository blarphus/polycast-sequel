import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import pool from '../db.js';
import { getEnglishFrequency } from '../lib/englishFrequency.js';

const router = Router();

const API_HEADERS = { 'User-Agent': 'Polycast/1.0' };
const SKIP_PATTERNS = /\b(municipality|commune|city|town|village|district|province|county|region|department|prefecture|borough|family name|given name|surname|first name|person|people|human|Wikimedia|disambiguation|album|song|film|novel|band|magazine|journal|newspaper|TV series|television series)\b/i;

async function fetchWordImage(searchTerm, word, lang) {
  try {
    // Phase 1: Wikimedia Commons search using Gemini's targeted term
    const commonsParams = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: searchTerm,
      gsrnamespace: '6',
      prop: 'imageinfo',
      iiprop: 'url|mime',
      iiurlwidth: '400',
      format: 'json',
      gsrlimit: '10',
    });
    const commonsRes = await fetch(
      `https://commons.wikimedia.org/w/api.php?${commonsParams}`,
      { headers: API_HEADERS },
    );
    if (!commonsRes.ok) {
      console.error('Commons search failed:', commonsRes.status);
    } else {
      const commonsData = await commonsRes.json();
      const pages = Object.values(commonsData.query?.pages || {});
      const jpeg = pages.find(
        (p) => p.imageinfo?.[0]?.mime === 'image/jpeg',
      );
      if (jpeg) return jpeg.imageinfo[0].thumburl;
    }

    // Phase 2: Wikipedia pageimages using the raw word
    const wikiLang = lang || 'en';
    const wikiParams = new URLSearchParams({
      action: 'query',
      titles: word,
      prop: 'pageimages',
      format: 'json',
      pithumbsize: '400',
      redirects: '1',
    });
    const wikiRes = await fetch(
      `https://${wikiLang}.wikipedia.org/w/api.php?${wikiParams}`,
      { headers: API_HEADERS },
    );
    if (!wikiRes.ok) {
      console.error('Wikipedia pageimages failed:', wikiRes.status);
    } else {
      const wikiData = await wikiRes.json();
      const pages = wikiData.query?.pages;
      if (pages) {
        const pageId = Object.keys(pages)[0];
        if (pageId !== '-1') {
          const thumbnail = pages[pageId]?.thumbnail?.source;
          if (thumbnail) return thumbnail;
        }
      }
    }

    // Phase 3: Wikidata entity search with iteration
    const searchParams = new URLSearchParams({
      action: 'wbsearchentities',
      search: word,
      language: lang || 'en',
      format: 'json',
      limit: '10',
    });
    const searchRes = await fetch(
      `https://www.wikidata.org/w/api.php?${searchParams}`,
      { headers: API_HEADERS },
    );
    if (!searchRes.ok) {
      console.error('Wikidata search failed:', searchRes.status);
      return null;
    }
    const searchData = await searchRes.json();
    const results = searchData.search || [];

    const candidates = results.filter((r) => !SKIP_PATTERNS.test(r.description || ''));
    for (const entity of candidates) {
      const claimsParams = new URLSearchParams({
        action: 'wbgetclaims',
        entity: entity.id,
        property: 'P18',
        format: 'json',
      });
      const claimsRes = await fetch(
        `https://www.wikidata.org/w/api.php?${claimsParams}`,
        { headers: API_HEADERS },
      );
      if (!claimsRes.ok) {
        console.error('Wikidata claims failed for', entity.id, ':', claimsRes.status);
        continue;
      }
      const claimsData = await claimsRes.json();
      const filename = claimsData.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (filename) {
        return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=400`;
      }
    }

    return null;
  } catch (err) {
    console.error('fetchWordImage error:', err);
    return null;
  }
}

async function callGemini(prompt, generationConfig = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    console.error('Gemini API error:', err);
    throw new Error('Gemini request failed');
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error('Gemini API returned no text content:', JSON.stringify(data).slice(0, 500));
    throw new Error('Gemini returned no text content');
  }
  return text;
}

/**
 * GET /api/dictionary/lookup?word=X&sentence=Y&nativeLang=Z&targetLang=W
 * Uses Gemini to provide definition, POS, and image_term.
 * Translation comes from /api/dictionary/translate-word (Google Translate).
 */
router.get('/api/dictionary/lookup', authMiddleware, async (req, res) => {
  const { word, sentence, nativeLang, targetLang } = req.query;

  if (!word || !sentence) {
    return res.status(400).json({ error: 'word and sentence are required' });
  }

  if (!nativeLang) {
    return res.status(400).json({ error: 'nativeLang is required' });
  }

  try {
    const prompt = `A user learning ${targetLang || 'a language'} clicked "${word}" in: "${sentence}". Their native language is ${nativeLang}.

Return a JSON object with exactly these keys:
{"definition":"...","part_of_speech":"...","image_term":"..."}

- "definition": brief usage explanation in ${nativeLang}, 12 words max, no markdown
- "part_of_speech": one of noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle
- "image_term": a 1-4 word English phrase for finding a photo of this concept. For concrete nouns, repeat the word (e.g. "cat" → "cat"). For verbs, describe the action (e.g. "run" → "person running"). For adjectives, give a visual example (e.g. "beautiful" → "beautiful flower"). For abstract nouns, name a concrete symbol (e.g. "music" → "musical instrument").

Respond with ONLY the JSON object, no other text.`;

    const raw = await callGemini(prompt, {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 160,
      responseMimeType: 'application/json',
    });

    const parsed = JSON.parse(raw);
    if (!parsed.definition) {
      console.error('Gemini lookup returned incomplete JSON:', raw.slice(0, 300));
    }
    const definition = parsed.definition || '';
    const part_of_speech = parsed.part_of_speech || null;
    const image_term = parsed.image_term || word;

    return res.json({ word, definition, part_of_speech, image_term });
  } catch (err) {
    console.error('Dictionary lookup error:', err);
    return res.status(500).json({ error: err.message || 'Lookup failed' });
  }
});

/**
 * GET /api/dictionary/wikt-lookup?word=X&targetLang=Y&nativeLang=Z
 * Proxies to WiktApi for structured Wiktionary definitions.
 */
const WIKT_EDITIONS = new Set([
  'cs','de','el','en','es','fr','id','it','ja','ko',
  'ku','ms','nl','pl','pt','ru','th','tr','vi','zh',
]);

router.get('/api/dictionary/wikt-lookup', authMiddleware, async (req, res) => {
  const { word, targetLang, nativeLang } = req.query;

  if (!word || !targetLang || !nativeLang) {
    return res.status(400).json({ error: 'word, targetLang, and nativeLang are required' });
  }

  const edition = WIKT_EDITIONS.has(nativeLang) ? nativeLang : 'en';

  try {
    const url = `https://api.wiktapi.dev/v1/${edition}/word/${encodeURIComponent(word)}/definitions?lang=${targetLang}`;
    const response = await fetch(url, { headers: API_HEADERS });

    if (response.status === 404) {
      return res.json({ word, senses: [] });
    }

    if (!response.ok) {
      console.error('WiktApi error:', response.status, await response.text().catch(() => ''));
      return res.status(502).json({ error: 'WiktApi request failed' });
    }

    const data = await response.json();

    // Flatten all senses from all POS groups, filtering out form-of entries
    const senses = [];
    for (const entry of data.definitions || []) {
      const pos = entry.pos || '';
      for (const sense of entry.senses || []) {
        const tags = sense.tags || [];
        if (tags.includes('form-of')) continue;
        const examples = sense.examples || [];
        const example = examples[0]?.text || null;
        for (const gloss of sense.glosses || []) {
          if (!gloss) continue;
          senses.push({ gloss, pos, tags, example });
        }
      }
    }

    return res.json({ word, senses });
  } catch (err) {
    console.error('WiktApi network error:', err);
    return res.status(502).json({ error: 'WiktApi request failed' });
  }
});

/**
 * GET /api/dictionary/translate-word
 * Translate a single word via Google Cloud Translation API (v2).
 * Used by WordPopup for fast translation while Gemini handles definition/POS.
 */
router.get('/api/dictionary/translate-word', authMiddleware, async (req, res) => {
  const { word, targetLang, nativeLang } = req.query;

  if (!word || !nativeLang) {
    return res.status(400).json({ error: 'word and nativeLang are required' });
  }

  try {
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_TRANSLATE_API_KEY is not configured');

    const params = new URLSearchParams({
      q: word,
      target: nativeLang,
      key: apiKey,
      format: 'text',
    });
    if (targetLang) params.set('source', targetLang);

    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2?${params}`,
      { method: 'POST' },
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('Google Translate word API error:', err);
      throw new Error('Word translation request failed');
    }

    const data = await response.json();
    const translation = data.data?.translations?.[0]?.translatedText;
    if (!translation) {
      console.error('Google Translate word returned unexpected structure:', JSON.stringify(data).slice(0, 500));
    }

    return res.json({ translation: translation || '' });
  } catch (err) {
    console.error('Word translation error:', err);
    return res.status(500).json({ error: err.message || 'Word translation failed' });
  }
});

/**
 * POST /api/dictionary/translate
 * Translate a full sentence via Google Cloud Translation API (v2).
 * Used for transcript panel translations.
 */
router.post('/api/dictionary/translate', authMiddleware, async (req, res) => {
  const { sentence, fromLang, toLang } = req.body;

  if (!sentence || !toLang) {
    return res.status(400).json({ error: 'sentence and toLang are required' });
  }

  try {
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_TRANSLATE_API_KEY is not configured');

    const params = new URLSearchParams({
      q: sentence,
      target: toLang,
      key: apiKey,
      format: 'text',
    });
    if (fromLang) params.set('source', fromLang);

    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2?${params}`,
      { method: 'POST' },
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('Google Translate API error:', err);
      throw new Error('Translation request failed');
    }

    const data = await response.json();
    const translation = data.data?.translations?.[0]?.translatedText;
    if (!translation) {
      console.error('Google Translate returned unexpected structure:', JSON.stringify(data).slice(0, 500));
    }

    return res.json({ translation: translation || '' });
  } catch (err) {
    console.error('Sentence translation error:', err);
    return res.status(500).json({ error: err.message || 'Translation failed' });
  }
});

/**
 * POST /api/dictionary/enrich
 * Full enrichment call (translation, definition, POS, frequency, example).
 * Called when the user saves a word — quality over speed.
 */
router.post('/api/dictionary/enrich', authMiddleware, async (req, res) => {
  const { word, sentence, nativeLang, targetLang, imageTerm } = req.body;

  if (!word || !sentence || !nativeLang) {
    return res.status(400).json({ error: 'word, sentence, and nativeLang are required' });
  }

  try {
    const prompt = `You are a language-learning assistant. A user clicked the word "${word}" in: "${sentence}".
${targetLang ? `The sentence is in ${targetLang}.` : ''}
The user's native language is ${nativeLang}.

Respond in EXACTLY this format (six parts separated by " // "):
TRANSLATION // DEFINITION // PART_OF_SPEECH // FREQUENCY // EXAMPLE // IMAGE_TERM

- TRANSLATION: The word translated into ${nativeLang}. Just the word(s), nothing else.
- DEFINITION: A brief explanation of how this word is used in the given sentence, in ${nativeLang}. 15 words max. No markdown.
- PART_OF_SPEECH: One of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle. Lowercase English.
- FREQUENCY: An integer 1-10 rating how common this word is for a language learner:
  1-2: Rare/specialized words most learners won't encounter
  3-4: Uncommon words that appear in specific contexts
  5-6: Moderately common words useful for intermediate learners
  7-8: Common everyday words important for conversation
  9-10: Essential high-frequency words (top 500 most used)
- EXAMPLE: A short example sentence in ${targetLang || 'the target language'} using the word. Wrap the word with tildes like ~word~. Keep it under 15 words.
- IMAGE_TERM: A 1-4 word English phrase for finding a photo of this specific meaning. For "charge" meaning electricity → "phone charging cable". For "charge" meaning attack → "cavalry charge battle".`;

    const raw = await callGemini(prompt);

    const parts = raw.split('//').map((s) => s.trim());
    if (parts.length < 6) {
      console.error(`Gemini enrich returned ${parts.length} parts instead of 6:`, raw.slice(0, 300));
    }
    const translation = parts[0] || '';
    const definition = parts[1] || '';
    const part_of_speech = parts[2] || null;
    let frequency = parts[3] ? parseInt(parts[3], 10) : null;
    if (parts[3] && isNaN(frequency)) {
      console.error('Gemini enrich returned non-numeric frequency:', parts[3]);
      frequency = null;
    }
    const example_sentence = parts[4] || null;
    const geminiImageTerm = parts[5]?.trim() || null;

    // For English target words, override Gemini frequency with SUBTLEX-US corpus data
    if (targetLang === 'en' || targetLang?.startsWith('en-')) {
      const corpusFreq = getEnglishFrequency(word);
      if (corpusFreq !== null) frequency = corpusFreq;
    }

    // Fetch image: use caller's imageTerm (from /lookup), Gemini's IMAGE_TERM, or raw word
    const imageSearchTerm = imageTerm || geminiImageTerm || word;
    const langCode = (targetLang || '').split('-')[0] || 'en';
    const image_url = await fetchWordImage(imageSearchTerm, word, langCode);

    return res.json({ word, translation, definition, part_of_speech, frequency, example_sentence, image_url });
  } catch (err) {
    console.error('Dictionary enrich error:', err);
    return res.status(500).json({ error: err.message || 'Enrichment failed' });
  }
});

// ---------------------------------------------------------------------------
// SRS (Spaced Repetition) — Anki-style algorithm
// ---------------------------------------------------------------------------

const LEARNING_STEPS = [60, 600];        // 1 min, 10 min
const GRADUATING_INTERVAL = 86400;       // 1 day
const EASY_GRADUATING_INTERVAL = 345600; // 4 days
const RELEARNING_STEP = 600;             // 10 min
const MIN_EASE = 1.3;
const LAPSE_INTERVAL_FACTOR = 0.1;       // Again in review: new = old × 0.1
const MIN_REVIEW_INTERVAL = 86400;       // 1 day minimum

/**
 * GET /api/dictionary/due -- Cards due for review + new cards
 */
router.get('/api/dictionary/due', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM saved_words WHERE user_id = $1
         AND (due_at <= NOW() OR due_at IS NULL)
       ORDER BY
         CASE WHEN learning_step IS NOT NULL THEN 0
              WHEN due_at IS NOT NULL THEN 1
              ELSE 2 END,
         due_at ASC NULLS LAST,
         frequency DESC NULLS LAST,
         created_at ASC`,
      [req.userId],
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching due words:', err);
    return res.status(500).json({ error: 'Failed to fetch due words' });
  }
});

/**
 * PATCH /api/dictionary/words/:id/review -- Record an Anki-style SRS review
 * Body: { answer: 'again' | 'hard' | 'good' | 'easy' }
 */
router.patch('/api/dictionary/words/:id/review', authMiddleware, async (req, res) => {
  const { answer } = req.body;

  if (!answer || !['again', 'hard', 'good', 'easy'].includes(answer)) {
    return res.status(400).json({ error: 'answer must be again, hard, good, or easy' });
  }

  try {
    const { rows: existing } = await pool.query(
      'SELECT * FROM saved_words WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId],
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Word not found' });
    }

    const card = existing[0];
    const isLearning = card.learning_step !== null || card.srs_interval === 0;
    const isRelearning = card.learning_step !== null && card.srs_interval > 0;

    let newInterval = card.srs_interval;
    let newEase = card.ease_factor;
    let newStep = card.learning_step;
    let dueSeconds;

    if (isLearning) {
      // ---- Learning / Relearning phase ----
      const step = card.learning_step ?? 0;

      switch (answer) {
        case 'again':
          newStep = 0;
          dueSeconds = LEARNING_STEPS[0]; // 1 min
          break;
        case 'hard':
          newStep = step;
          dueSeconds = step === 0 ? 360 : LEARNING_STEPS[1]; // 6 min or 10 min
          break;
        case 'good':
          if (step >= LEARNING_STEPS.length - 1) {
            // Graduate
            newStep = null;
            if (isRelearning) {
              // Keep existing srs_interval for relearning graduation
              dueSeconds = card.srs_interval;
            } else {
              newInterval = GRADUATING_INTERVAL;
              dueSeconds = GRADUATING_INTERVAL;
            }
          } else {
            newStep = step + 1;
            dueSeconds = LEARNING_STEPS[step + 1];
          }
          break;
        case 'easy':
          newStep = null;
          newInterval = EASY_GRADUATING_INTERVAL;
          newEase = Math.max(newEase + 0.15, MIN_EASE);
          dueSeconds = EASY_GRADUATING_INTERVAL;
          break;
      }
    } else {
      // ---- Review phase (graduated cards) ----
      const oldInterval = card.srs_interval;

      switch (answer) {
        case 'again':
          newEase = Math.max(newEase - 0.20, MIN_EASE);
          newInterval = Math.max(Math.round(oldInterval * LAPSE_INTERVAL_FACTOR), MIN_REVIEW_INTERVAL);
          newStep = 0; // Enter relearning
          dueSeconds = RELEARNING_STEP; // 10 min
          break;
        case 'hard':
          newEase = Math.max(newEase - 0.15, MIN_EASE);
          newInterval = Math.max(Math.round(oldInterval * 1.2), MIN_REVIEW_INTERVAL);
          dueSeconds = newInterval;
          break;
        case 'good':
          newInterval = Math.max(Math.round(oldInterval * newEase), MIN_REVIEW_INTERVAL);
          dueSeconds = newInterval;
          break;
        case 'easy':
          newEase = Math.max(newEase + 0.15, MIN_EASE);
          newInterval = Math.max(Math.round(oldInterval * newEase * 1.3), MIN_REVIEW_INTERVAL);
          dueSeconds = newInterval;
          break;
      }
    }

    const { rows: updated } = await pool.query(
      `UPDATE saved_words
       SET srs_interval = $1,
           ease_factor = $2,
           learning_step = $3,
           due_at = NOW() + ($4 || ' seconds')::INTERVAL,
           last_reviewed_at = NOW(),
           correct_count = correct_count + $5,
           incorrect_count = incorrect_count + $6
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
      [
        newInterval,
        newEase,
        newStep,
        String(dueSeconds),
        answer === 'again' ? 0 : 1,
        answer === 'again' ? 1 : 0,
        req.params.id,
        req.userId,
      ],
    );

    return res.json(updated[0]);
  } catch (err) {
    console.error('Error reviewing word:', err);
    return res.status(500).json({ error: 'Failed to record review' });
  }
});

// ---------------------------------------------------------------------------
// Saved Words CRUD
// ---------------------------------------------------------------------------

/**
 * GET /api/dictionary/words -- List all saved words for the authenticated user
 */
router.get('/api/dictionary/words', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM saved_words WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId],
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching saved words:', err);
    return res.status(500).json({ error: 'Failed to fetch saved words' });
  }
});

/**
 * POST /api/dictionary/words -- Save a word to the personal dictionary
 */
router.post('/api/dictionary/words', authMiddleware, async (req, res) => {
  const { word, translation, definition, target_language, sentence_context, frequency, example_sentence, part_of_speech, image_url } = req.body;

  if (!word) {
    return res.status(400).json({ error: 'word is required' });
  }

  try {
    // Check if this exact definition already exists
    const { rows: existing } = await pool.query(
      `SELECT * FROM saved_words
       WHERE user_id = $1 AND word = $2
         AND target_language IS NOT DISTINCT FROM $3
         AND definition = $4`,
      [req.userId, word, target_language || null, definition || ''],
    );
    if (existing.length > 0) return res.status(200).json(existing[0]);

    // Insert new definition
    const { rows } = await pool.query(
      `INSERT INTO saved_words (user_id, word, translation, definition, target_language, sentence_context, frequency, example_sentence, part_of_speech, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.userId, word, translation || '', definition || '', target_language || null, sentence_context || null, frequency || null, example_sentence || null, part_of_speech || null, image_url || null],
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error saving word:', err);
    return res.status(500).json({ error: 'Failed to save word' });
  }
});

/**
 * DELETE /api/dictionary/words/:id -- Remove a saved word
 */
router.delete('/api/dictionary/words/:id', authMiddleware, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM saved_words WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId],
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Word not found' });
    }
    return res.status(204).end();
  } catch (err) {
    console.error('Error deleting saved word:', err);
    return res.status(500).json({ error: 'Failed to delete word' });
  }
});

export default router;
