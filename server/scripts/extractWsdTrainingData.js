import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import path from 'path';
import crypto from 'crypto';

// ── Config ────────────────────────────────────────────────────────
const LANGUAGES = [
  { code: 'en', name: 'English',    file: 'kaikki.org-dictionary-English.jsonl.gz' },
  { code: 'es', name: 'Spanish',    file: 'kaikki.org-dictionary-Spanish.jsonl.gz' },
  { code: 'pt', name: 'Portuguese', file: 'kaikki.org-dictionary-Portuguese.jsonl.gz' },
  { code: 'fr', name: 'French',     file: 'kaikki.org-dictionary-French.jsonl.gz' },
  { code: 'de', name: 'German',     file: 'kaikki.org-dictionary-German.jsonl.gz' },
];

const MAX_PER_LANG = 6000;
const MAX_QUOTE_LEN = 300;
const EVAL_FRACTION = 0.1; // 10% eval

// Deterministic train/eval split based on word hash
function isEval(word) {
  const hash = crypto.createHash('md5').update(word).digest();
  return (hash[0] / 256) < EVAL_FRACTION;
}

// ── Pass 1: Collect all entries grouped by (word, lang) ───────────
async function collectEntries(lang, dir) {
  const filePath = path.join(dir, lang.file);
  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP ${lang.name} — file not found`);
    return new Map();
  }

  console.log(`  Reading ${lang.name}...`);
  const groups = new Map(); // key: word -> { senses: [{pos, gloss, examples}] }

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath).pipe(zlib.createGunzip()),
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let raw;
    try { raw = JSON.parse(line); } catch { continue; }

    const word = raw.word;
    if (!word) continue;

    const pos = raw.pos || '?';
    const senses = (raw.senses || []).filter(s => {
      const glosses = s.glosses || s.raw_glosses || [];
      return glosses.length > 0;
    });

    if (senses.length === 0) continue;

    if (!groups.has(word)) {
      groups.set(word, []);
    }

    const group = groups.get(word);
    for (const sense of senses) {
      const glosses = sense.glosses || sense.raw_glosses || [];
      // Take the last (most specific) gloss
      const gloss = glosses[glosses.length - 1];
      if (!gloss) continue;

      const examples = (sense.examples || [])
        .filter(ex => {
          if (!ex.text || !ex.text.trim()) return false;
          // Skip long quotations
          if (ex.type === 'quotation' && ex.text.length > MAX_QUOTE_LEN) return false;
          return true;
        })
        .map(ex => ex.text.trim());

      group.push({ pos, gloss, examples });
    }
  }

  return groups;
}

// ── Pass 2: Generate training samples from grouped entries ────────
function generateSamples(groups, langCode) {
  const samples = [];

  for (const [word, senses] of groups) {
    if (senses.length < 2) continue;

    // Build the glosses list (matches production "pos: gloss" format)
    const glosses = senses.map(s => `${s.pos}: ${s.gloss}`);

    // For each sense that has examples, create a training sample per example
    for (let i = 0; i < senses.length; i++) {
      for (const exText of senses[i].examples) {
        samples.push({
          sentence: `[${langCode}] ${exText}`,
          word,
          lang: langCode,
          correct_index: i,
          glosses,
        });
      }
    }
  }

  return samples;
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const dir = process.argv[2] || path.join(process.env.HOME, 'Desktop', 'wiktionary-test');
  const outDir = dir;

  console.log('Extracting WSD training data...\n');

  const trainSamples = [];
  const evalSamples = [];
  const stats = {};

  for (const lang of LANGUAGES) {
    const groups = await collectEntries(lang, dir);
    const allSamples = generateSamples(groups, lang.code);

    // Split into train/eval by word
    const trainLang = [];
    const evalLang = [];
    for (const sample of allSamples) {
      if (isEval(sample.word)) {
        evalLang.push(sample);
      } else {
        trainLang.push(sample);
      }
    }

    // Cap training samples per language
    if (trainLang.length > MAX_PER_LANG) {
      // Shuffle deterministically then take first MAX_PER_LANG
      trainLang.sort((a, b) => {
        const ha = crypto.createHash('md5').update(a.sentence).digest('hex');
        const hb = crypto.createHash('md5').update(b.sentence).digest('hex');
        return ha.localeCompare(hb);
      });
      trainLang.length = MAX_PER_LANG;
    }

    // Cap eval proportionally
    const evalCap = Math.ceil(MAX_PER_LANG * EVAL_FRACTION / (1 - EVAL_FRACTION));
    if (evalLang.length > evalCap) {
      evalLang.sort((a, b) => {
        const ha = crypto.createHash('md5').update(a.sentence).digest('hex');
        const hb = crypto.createHash('md5').update(b.sentence).digest('hex');
        return ha.localeCompare(hb);
      });
      evalLang.length = evalCap;
    }

    trainSamples.push(...trainLang);
    evalSamples.push(...evalLang);

    stats[lang.code] = {
      name: lang.name,
      totalRaw: allSamples.length,
      train: trainLang.length,
      eval: evalLang.length,
    };

    console.log(`  ${lang.name}: ${allSamples.length} raw -> ${trainLang.length} train, ${evalLang.length} eval`);
  }

  // Write output files
  const trainPath = path.join(outDir, 'wsd-train.jsonl');
  const evalPath = path.join(outDir, 'wsd-eval.jsonl');

  fs.writeFileSync(trainPath, trainSamples.map(s => JSON.stringify(s)).join('\n') + '\n');
  fs.writeFileSync(evalPath, evalSamples.map(s => JSON.stringify(s)).join('\n') + '\n');

  console.log(`\nOutput:`);
  console.log(`  ${trainPath} (${trainSamples.length} samples)`);
  console.log(`  ${evalPath} (${evalSamples.length} samples)`);

  console.log(`\nPer-language breakdown:`);
  console.log('  Language       Raw       Train     Eval');
  console.log('  ' + '-'.repeat(50));
  for (const lang of LANGUAGES) {
    const s = stats[lang.code];
    if (!s) continue;
    console.log(`  ${s.name.padEnd(14)} ${String(s.totalRaw).padStart(8)}  ${String(s.train).padStart(8)}  ${String(s.eval).padStart(8)}`);
  }
  console.log('  ' + '-'.repeat(50));
  console.log(`  ${'TOTAL'.padEnd(14)} ${String(trainSamples.length + evalSamples.length).padStart(8)}  ${String(trainSamples.length).padStart(8)}  ${String(evalSamples.length).padStart(8)}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
