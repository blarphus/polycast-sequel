import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

import { callGemini } from '../lib/gemini.js';

const DEFAULT_EVAL_PATH = path.join(process.env.HOME || '', 'Desktop', 'wiktionary-test', 'wsd-eval.jsonl');
const REQUIRED_LANGUAGES = ['en', 'es', 'pt', 'fr', 'de'];

function parseArgs(argv) {
  const options = {
    evalPath: DEFAULT_EVAL_PATH,
    perLang: 20,
    maxErrorsShown: 10,
    sampleOutPath: null,
    sampleInPath: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--eval-path') {
      options.evalPath = argv[i + 1];
      i += 1;
    } else if (arg === '--per-lang') {
      options.perLang = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (arg === '--max-errors-shown') {
      options.maxErrorsShown = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (arg === '--sample-out') {
      options.sampleOutPath = argv[i + 1];
      i += 1;
    } else if (arg === '--sample-in') {
      options.sampleInPath = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.perLang) || options.perLang <= 0) {
    throw new Error('--per-lang must be a positive integer');
  }

  if (!Number.isInteger(options.maxErrorsShown) || options.maxErrorsShown < 0) {
    throw new Error('--max-errors-shown must be a non-negative integer');
  }

  return options;
}

function loadSavedSample(samplePath) {
  const sourcePath = path.resolve(samplePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Saved sample file not found: ${sourcePath}`);
  }

  const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  if (!Array.isArray(payload.samples)) {
    throw new Error(`Saved sample file is missing a "samples" array: ${sourcePath}`);
  }

  return payload.samples;
}

function loadEvalSamples(evalPath) {
  const samples = [];
  const sourcePath = path.resolve(evalPath);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Eval file not found: ${sourcePath}`);
  }

  const lines = fs.readFileSync(sourcePath, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const sample = JSON.parse(line);
    samples.push({ ...sample, sourceLine: i + 1 });
  }

  return samples;
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function pickSamplesPerLanguage(samples, perLang) {
  const byLang = new Map();

  for (const sample of samples) {
    const bucket = byLang.get(sample.lang) || [];
    bucket.push(sample);
    byLang.set(sample.lang, bucket);
  }

  const picked = [];
  for (const lang of REQUIRED_LANGUAGES) {
    const bucket = byLang.get(lang) || [];
    if (bucket.length < perLang) {
      throw new Error(`Not enough eval samples for ${lang}: need ${perLang}, found ${bucket.length}`);
    }
    shuffleInPlace(bucket);
    picked.push(...bucket.slice(0, perLang));
  }

  return picked;
}

function maybeWriteSample(selectedSamples, sampleOutPath) {
  if (!sampleOutPath) return;

  const destinationPath = path.resolve(sampleOutPath);
  const payload = {
    createdAt: new Date().toISOString(),
    sampleCount: selectedSamples.length,
    samples: selectedSamples,
  };
  fs.writeFileSync(destinationPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function buildSensePrompt(sample) {
  const senseList = sample.glosses.map((gloss, index) => {
    const separator = gloss.indexOf(':');
    const pos = separator === -1 ? 'unknown' : gloss.slice(0, separator).trim();
    const definition = separator === -1 ? gloss.trim() : gloss.slice(separator + 1).trim();
    return `${index}: [${pos}] ${definition}`;
  }).join('\n');

  return `The word "${sample.word}" appears in: "${sample.sentence}" (${sample.lang}).
Pick the sense index that best matches. Return ONLY the integer.
${senseList}`;
}

function parseSenseIndex(raw, senseCount) {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return { valid: false, parsed: null };
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= senseCount) {
    return { valid: false, parsed };
  }

  return { valid: true, parsed };
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function formatPercent(numerator, denominator) {
  if (denominator === 0) return '0.0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

async function benchmarkSample(sample) {
  const prompt = buildSensePrompt(sample);
  const startedAt = Date.now();
  const raw = await callGemini(prompt, {
    thinkingConfig: { thinkingBudget: 0 },
    maxOutputTokens: 10,
    responseMimeType: 'text/plain',
  });
  const latencyMs = Date.now() - startedAt;
  const parsed = parseSenseIndex(raw, sample.glosses.length);
  const predictedIndex = parsed.valid ? parsed.parsed : null;

  return {
    latencyMs,
    raw,
    predictedIndex,
    invalidOutput: !parsed.valid,
    correct: parsed.valid && predictedIndex === sample.correct_index,
  };
}

function printSummary(results, options) {
  const overallCorrect = results.filter((result) => result.correct).length;
  const invalidOutputs = results.filter((result) => result.invalidOutput).length;
  const latencies = results.map((result) => result.latencyMs);

  console.log('\nGemini Flash WSD Benchmark');
  console.log(`Eval path: ${path.resolve(options.evalPath)}`);
  console.log(`Questions: ${results.length} (${options.perLang} per language, fresh random sample)`);
  console.log(`Overall accuracy: ${overallCorrect}/${results.length} = ${formatPercent(overallCorrect, results.length)}`);
  console.log(`Invalid outputs: ${invalidOutputs}/${results.length} = ${formatPercent(invalidOutputs, results.length)}`);
  console.log(`Average latency: ${mean(latencies).toFixed(0)} ms`);
  console.log(`Median latency: ${median(latencies).toFixed(0)} ms`);

  console.log('\nPer-language accuracy:');
  for (const lang of REQUIRED_LANGUAGES) {
    const langResults = results.filter((result) => result.sample.lang === lang);
    const correct = langResults.filter((result) => result.correct).length;
    console.log(`  ${lang}: ${correct}/${langResults.length} = ${formatPercent(correct, langResults.length)}`);
  }

  const errors = results.filter((result) => !result.correct).slice(0, options.maxErrorsShown);
  if (errors.length > 0) {
    console.log(`\nFirst ${errors.length} misses:`);
    for (const result of errors) {
      const { sample } = result;
      const predicted = result.invalidOutput ? `INVALID (${JSON.stringify(result.raw.trim())})` : result.predictedIndex;
      console.log(
        `  [${sample.lang}] line ${sample.sourceLine} "${sample.word}" expected=${sample.correct_index} predicted=${predicted} latency=${result.latencyMs}ms`,
      );
    }
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in the root .env');
  }

  const options = parseArgs(process.argv.slice(2));
  const samples = options.sampleInPath ? null : loadEvalSamples(options.evalPath);
  const selectedSamples = options.sampleInPath
    ? loadSavedSample(options.sampleInPath)
    : pickSamplesPerLanguage(samples, options.perLang);
  const results = [];
  maybeWriteSample(selectedSamples, options.sampleOutPath);

  if (options.sampleInPath) {
    console.log(`Loaded saved sample with ${selectedSamples.length} questions from ${path.resolve(options.sampleInPath)}.`);
  } else {
    console.log(`Loaded ${samples.length} eval samples. Running ${selectedSamples.length} Gemini requests sequentially...`);
    if (options.sampleOutPath) {
      console.log(`Saved sampled questions to ${path.resolve(options.sampleOutPath)}.`);
    }
  }

  for (let i = 0; i < selectedSamples.length; i += 1) {
    const sample = selectedSamples[i];
    const result = await benchmarkSample(sample);
    results.push({ sample, ...result });

    if ((i + 1) % 10 === 0 || i + 1 === selectedSamples.length) {
      const correct = results.filter((entry) => entry.correct).length;
      console.log(
        `[${i + 1}/${selectedSamples.length}] accuracy=${formatPercent(correct, results.length)} invalid=${results.filter((entry) => entry.invalidOutput).length}`,
      );
    }
  }

  printSummary(results, options);
}

main().catch((err) => {
  console.error(`Gemini WSD benchmark failed: ${err.message}`);
  process.exit(1);
});
