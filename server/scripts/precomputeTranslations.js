/**
 * Pre-compute pt and es translations for enriched template words.
 *
 * Usage:  node server/scripts/precomputeTranslations.js
 *
 * Requires GEMINI_API_KEY in root .env (for disambiguation / missing translations).
 * Reads cefrj-a1.json, adds a `translations` field to each enriched word, writes back.
 * Safe to re-run: skips words that already have translations for a given language.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.join(path.dirname(__filename), '..', '..', '.env') });

import { fetchWiktTranslations, callGemini, fetchWiktSenses } from '../enrichWord.js';

const __dirname = path.dirname(__filename);
const TEMPLATE_PATH = path.join(__dirname, '..', 'data', 'templates', 'cefrj-a1.json');
const LANGUAGES = ['pt', 'es'];

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function translateUnit(unit, lang) {
  const words = unit.words;
  if (!Array.isArray(words) || typeof words[0] !== 'object') return;

  // Find which words still need translations for this language
  const needsWork = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i].translations?.[lang]?.translation) continue; // already done
    needsWork.push(i);
  }

  if (needsWork.length === 0) {
    console.log(`    ${lang}: all ${words.length} already done, skipping`);
    return;
  }

  // 1. Fetch translations from English Wiktionary for words that need it
  const translationsPerIdx = {};
  for (const i of needsWork) {
    try {
      translationsPerIdx[i] = await fetchWiktTranslations(words[i].word, lang);
    } catch (err) {
      console.error(`    fetchWiktTranslations failed for "${words[i].word}":`, err.message);
      translationsPerIdx[i] = [];
    }
  }
  await delay(200);

  // 2. For words with no senses at all, fall back to native-edition glosses
  const fallbackSensesMap = {};
  for (const i of needsWork) {
    if (translationsPerIdx[i].length === 0) {
      try {
        fallbackSensesMap[i] = await fetchWiktSenses(words[i].word, 'en', lang);
      } catch (err) {
        fallbackSensesMap[i] = [];
      }
    }
  }

  // 3. Build results + collect ambiguous words
  const results = {};
  const ambiguous = [];

  for (const i of needsWork) {
    const txns = translationsPerIdx[i];
    const withWords = txns.filter(t => t.words.length > 0);

    if (withWords.length === 1) {
      results[i] = { translation: withWords[0].words[0], definition: withWords[0].sense };
    } else if (withWords.length > 1) {
      ambiguous.push({
        index: i, word: words[i].word, definition: words[i].definition,
        senses: withWords.map(t => ({
          label: `[${t.pos}] ${t.sense} → ${t.words.join(', ')}`,
          translation: t.words[0],
          definition: t.sense,
        })),
      });
    } else if (txns.length > 0) {
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
      // else: no data at all — will be handled in step 5
    }
  }

  // 4. Gemini disambiguation for ambiguous words
  const allWords = words.map(w => w.word);

  if (ambiguous.length > 0) {
    const anyNeedTranslation = ambiguous.some(a => a.needsTranslation);

    const wordEntries = ambiguous.map((a, entryIdx) => {
      const senseList = a.senses.map((s, si) => `  ${si}: ${s.label}`).join('\n');
      const tag = a.needsTranslation ? ' [TRANSLATE]' : '';
      return `WORD ${entryIdx}: "${a.word}" (English definition: "${a.definition}")${tag}\n${senseList}`;
    }).join('\n\n');

    const translateInstruction = anyNeedTranslation
      ? `\nFor words marked [TRANSLATE], no dictionary translations exist for ${lang} — also provide a concise ${lang} translation (1-3 words) in the "translation" field.\nFor other words, omit the "translation" field.`
      : '';

    const responseFormat = anyNeedTranslation
      ? '{"sense_index": <int>} or {"sense_index": <int>, "translation": "..."} for [TRANSLATE] words'
      : '{"sense_index": <int>}';

    const prompt = `You are a vocabulary-list translation assistant.

A teacher is translating an English vocabulary unit into ${lang}.
The unit contains these words: ${allWords.join(', ')}

For each word below, pick the dictionary sense index that best matches the word's intended meaning in this thematic unit.
${translateInstruction}

${wordEntries}

Respond with ONLY a JSON array of objects, one per word above, in order:
[${responseFormat}, ...]

Each sense_index must be a valid index from the senses listed for that word.`;

    try {
      const raw = await callGemini(prompt, {
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 1500,
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
      console.error(`    Gemini disambiguation failed:`, err.message);
      for (const a of ambiguous) {
        const sense = a.senses[0];
        if (sense.translation) {
          results[a.index] = { translation: sense.translation, definition: sense.definition };
        }
      }
    }
  }

  // 5. Direct Gemini translation for words with no WiktAPI data at all
  const stillMissing = needsWork.filter(i => !results[i]);
  if (stillMissing.length > 0) {
    const missingEntries = stillMissing.map(i => ({
      word: words[i].word,
      definition: words[i].definition,
    }));

    const prompt = `Translate each English word/phrase below into ${lang}. Each word belongs to a vocabulary unit titled "${unit.title}".

${missingEntries.map((e, j) => `${j}. "${e.word}" — ${e.definition}`).join('\n')}

Respond with ONLY a JSON array of objects, one per word above, in order:
[{"translation": "..."}, ...]

Each translation should be a concise ${lang} equivalent (1-3 words).`;

    try {
      const raw = await callGemini(prompt, {
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 800,
        responseMimeType: 'application/json',
      });
      const picks = JSON.parse(raw);

      for (let j = 0; j < stillMissing.length; j++) {
        const i = stillMissing[j];
        const translation = picks[j]?.translation;
        if (translation) {
          results[i] = { translation, definition: words[i].definition };
        }
      }
    } catch (err) {
      console.error(`    Gemini direct translation failed:`, err.message);
    }
  }

  // 6. Store results
  for (const i of needsWork) {
    if (!words[i].translations) words[i].translations = {};
    words[i].translations[lang] = results[i] || null;
  }

  const resolved = needsWork.filter(i => results[i]).length;
  const missing = needsWork.filter(i => !results[i]).length;
  console.log(`    ${lang}: ${resolved} resolved, ${missing} missing (of ${needsWork.length} needed)`);
}

async function main() {
  const data = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf-8'));
  console.log(`Loaded ${data.units.length} units from ${path.basename(TEMPLATE_PATH)}\n`);

  for (const unit of data.units) {
    if (!Array.isArray(unit.words) || typeof unit.words[0] !== 'object') {
      console.log(`Skipping "${unit.title}" (not enriched)`);
      continue;
    }
    console.log(`Processing "${unit.title}" (${unit.words.length} words)...`);

    for (const lang of LANGUAGES) {
      await translateUnit(unit, lang);
      await delay(500);
    }
  }

  fs.writeFileSync(TEMPLATE_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nWrote updated template to ${path.basename(TEMPLATE_PATH)}`);
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
