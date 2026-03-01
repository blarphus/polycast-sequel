/**
 * enrich-a1.mjs — Re-enrich cefrj-a1.json with unit context.
 *
 * Each word is enriched with its sibling words so Gemini picks the correct
 * sense for ambiguous words (e.g. "miss" in an Essential Verbs unit →
 * "fail to hit", but "miss" in a People unit → "title for unmarried woman").
 *
 * Usage:  node enrich-a1.mjs [--dry-run] [--unit <unit-id>] [--word <word>]
 *
 * Requires GEMINI_API_KEY and PIXABAY_API_KEY in .env (or environment).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (match) process.env[match[1]] = match[2];
  }
}

// Dynamic import of server modules (they use ES modules)
const require = createRequire(import.meta.url);
const serverDir = path.join(__dirname, 'server');

// We need the functions from enrichWord.js
const { callGemini, fetchWordImage } = await import(path.join(serverDir, 'enrichWord.js'));
const { applyEnglishFrequency } = await import(path.join(serverDir, 'lib', 'englishFrequency.js'));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const JSON_PATH = path.join(serverDir, 'data', 'templates', 'cefrj-a1.json');
const CONCURRENCY = 5;
const DELAY_MS = 300; // small delay between Gemini calls to avoid rate limits

// CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const unitFilter = args.includes('--unit') ? args[args.indexOf('--unit') + 1] : null;
const wordFilter = args.includes('--word') ? args[args.indexOf('--word') + 1]?.toLowerCase() : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function enrichWordWithContext(word, siblingWords, unitTitle) {
  const contextLine = siblingWords.length > 0
    ? `\nThis word appears in a vocabulary unit titled "${unitTitle}" with these other words: ${siblingWords.join(', ')}.\nPick the sense that fits this thematic group.`
    : '';

  const prompt = `Translate and define the English word "${word}".${contextLine}

Return a JSON object with exactly these keys:
{"translation":"...","definition":"...","part_of_speech":"...","example_sentence":"...","frequency":0,"lemma":"...","forms":"...","image_term":"..."}

- translation: English translation/synonym for "${word}" matching the intended sense, 1-3 words max
- definition: what this word means in English, 12 words max, no markdown
- part_of_speech: one of noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle
- example_sentence: a short sentence in English using "${word}", wrap the word with tildes like ~word~, 15 words max
- frequency: integer 1-10 how common this word is (1-2 rare, 3-4 uncommon, 5-6 moderate, 7-8 common everyday, 9-10 essential top-500)
- lemma: dictionary/base form (infinitive for verbs, singular for nouns). Same as word if already base form. Empty string for particles/prepositions.
- forms: comma-separated inflected forms of the lemma (e.g. "run, runs, ran, running"). Empty string if uninflected.
- image_term: a 1-4 word English phrase describing a concrete, photographable subject that captures THIS SPECIFIC meaning of the word (matching the unit theme). Works as a stock-photo search query. Concrete nouns → the object itself. Abstract words → a vivid scene or tangible symbol. Do NOT repeat the word itself unless it is already a concrete noun.

Respond with ONLY the JSON object, no other text.`;

  const raw = await callGemini(prompt, {
    thinkingConfig: { thinkingBudget: 0 },
    maxOutputTokens: 400,
    responseMimeType: 'application/json',
  });

  const parsed = JSON.parse(raw);

  // Fetch image
  const image_url = await fetchWordImage(parsed.image_term || word);

  // Apply corpus frequency
  const rawFrequency = typeof parsed.frequency === 'number' ? parsed.frequency : null;
  const { frequency, frequency_count } = applyEnglishFrequency(word, 'en', rawFrequency);

  // Normalize forms
  let forms = null;
  if (parsed.forms) {
    const formsList = parsed.forms.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (formsList.length > 1) forms = JSON.stringify(formsList);
  }

  // Normalize lemma
  let lemma = parsed.lemma?.trim() || null;
  if (lemma && parsed.part_of_speech === 'verb') {
    if (!lemma.startsWith('to ')) lemma = 'to ' + lemma;
  }

  return {
    word,
    translation: parsed.translation || '',
    definition: parsed.definition || '',
    part_of_speech: parsed.part_of_speech || null,
    frequency,
    frequency_count,
    example_sentence: parsed.example_sentence || null,
    image_url,
    image_term: parsed.image_term || word,
    lemma,
    forms,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Loading cefrj-a1.json...');
  const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));

  const units = unitFilter
    ? data.units.filter(u => u.id === unitFilter)
    : data.units;

  if (units.length === 0) {
    console.error(`No units matched filter: ${unitFilter}`);
    process.exit(1);
  }

  let totalWords = 0;
  let enrichedCount = 0;
  let errorCount = 0;

  for (const unit of units) {
    const allWords = unit.words.map(w => typeof w === 'string' ? w : w.word);
    const wordsToEnrich = wordFilter
      ? unit.words.filter(w => (typeof w === 'string' ? w : w.word).toLowerCase() === wordFilter)
      : unit.words;

    if (wordsToEnrich.length === 0) continue;

    totalWords += wordsToEnrich.length;
    console.log(`\n--- Unit: ${unit.title} (${wordsToEnrich.length} words) ---`);

    // Process in batches for concurrency control
    for (let i = 0; i < wordsToEnrich.length; i += CONCURRENCY) {
      const batch = wordsToEnrich.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (wordEntry) => {
          const wordStr = typeof wordEntry === 'string' ? wordEntry : wordEntry.word;
          const siblings = allWords.filter(w => w.toLowerCase() !== wordStr.toLowerCase());

          const enriched = await enrichWordWithContext(wordStr, siblings, unit.title);

          // Find and update the word in the unit
          const idx = unit.words.findIndex(w =>
            (typeof w === 'string' ? w : w.word) === wordStr
          );
          if (idx !== -1) {
            unit.words[idx] = enriched;
          }

          console.log(`  ✓ ${wordStr}: ${enriched.definition} [${enriched.part_of_speech}]`);
          return enriched;
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          enrichedCount++;
        } else {
          errorCount++;
          console.error(`  ✗ Error:`, r.reason?.message || r.reason);
        }
      }

      // Small delay between batches
      if (i + CONCURRENCY < wordsToEnrich.length) {
        await sleep(DELAY_MS);
      }
    }
  }

  console.log(`\n=== Done: ${enrichedCount} enriched, ${errorCount} errors out of ${totalWords} total ===`);

  if (dryRun) {
    console.log('(dry run — not writing to disk)');
    // Print a sample
    const sampleUnit = units[0];
    const sampleWord = sampleUnit.words[0];
    console.log('\nSample output:');
    console.log(JSON.stringify(sampleWord, null, 2));
  } else {
    fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2) + '\n');
    console.log(`Written to ${JSON_PATH}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
