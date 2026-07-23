import { callGemini } from '../lib/gemini.js';
import {
  learnerDefinitionRules,
  learnerTranslationRules,
} from '../lib/learnerDefinitionPrompt.js';

const DEFINITION_SAMPLES = [
  { id: 'en-bank-river', target: 'en', native: 'es', word: 'bank', sentence: 'We sat on the bank and watched the river.', sense: 'the land beside a river' },
  { id: 'en-bank-money', target: 'en', native: 'es', word: 'bank', sentence: 'I deposited my paycheck at the bank.', sense: 'a financial institution' },
  { id: 'en-run-manage', target: 'en', native: 'es', word: 'run', sentence: 'Her parents run a small restaurant.', sense: 'to manage a business' },
  { id: 'en-light-weight', target: 'en', native: 'es', word: 'light', sentence: 'This suitcase is light enough to carry.', sense: 'not heavy' },
  { id: 'en-figure-out', target: 'en', native: 'es', word: 'figure out', sentence: 'I finally figured out how the lock works.', sense: 'to understand or solve something' },
  { id: 'en-eventually', target: 'en', native: 'es', word: 'eventually', sentence: 'After several attempts, she eventually passed the test.', sense: 'in the end, after some time' },
  { id: 'en-barely', target: 'en', native: 'es', word: 'barely', sentence: 'We barely caught the last bus.', sense: 'only just; almost not' },
  { id: 'en-despite', target: 'en', native: 'es', word: 'despite', sentence: 'Despite the rain, the match continued.', sense: 'without being prevented by something' },
  { id: 'en-awkward', target: 'en', native: 'es', word: 'awkward', sentence: 'There was an awkward silence after his joke.', sense: 'uncomfortable or embarrassing' },
  { id: 'en-set-put', target: 'en', native: 'es', word: 'set', sentence: 'Please set the groceries on the counter.', sense: 'to put something somewhere' },
  { id: 'en-troubled', target: 'en', native: 'es', word: 'troubled', sentence: 'She looked troubled by the news.', sense: 'worried or distressed' },
  { id: 'en-pitch-throw', target: 'en', native: 'es', word: 'pitch', sentence: 'He pitched the ball across the yard.', sense: 'to throw something' },
  { id: 'es-quedar-arrange', target: 'es', native: 'en', word: 'quedar', sentence: 'Quedamos a las seis delante del cine.', sense: 'to arrange to meet' },
  { id: 'es-quedar-fit', target: 'es', native: 'en', word: 'quedar', sentence: 'La chaqueta te queda muy bien.', sense: 'for clothing to fit or look on someone' },
  { id: 'es-llevar-wear', target: 'es', native: 'en', word: 'llevar', sentence: 'Hoy lleva una camisa azul.', sense: 'to wear clothing' },
  { id: 'es-llevar-duration', target: 'es', native: 'en', word: 'llevar', sentence: 'Llevo tres años estudiando español.', sense: 'to have spent a period doing something' },
  { id: 'es-meterse', target: 'es', native: 'en', word: 'meterse', sentence: 'No te metas conmigo.', sense: 'to mess with or pick on someone' },
  { id: 'es-lograr', target: 'es', native: 'en', word: 'lograr', sentence: 'Logramos llegar antes de que cerraran.', sense: 'to manage to achieve something' },
  { id: 'es-aunque', target: 'es', native: 'en', word: 'aunque', sentence: 'Aunque estaba cansada, terminó la tarea.', sense: 'although; introduces a contrast' },
  { id: 'es-pendiente', target: 'es', native: 'en', word: 'pendiente', sentence: 'Todavía tengo una tarea pendiente.', sense: 'not yet completed' },
  { id: 'es-recordar', target: 'es', native: 'en', word: 'recordar', sentence: 'No recuerdo dónde dejé las llaves.', sense: 'to remember' },
  { id: 'es-resultar', target: 'es', native: 'en', word: 'resultar', sentence: 'La prueba resultó más fácil de lo esperado.', sense: 'to turn out to be' },
  { id: 'es-echar-de-menos', target: 'es', native: 'en', word: 'echar de menos', sentence: 'Echo de menos a mis amigos del colegio.', sense: 'to miss someone or something' },
  { id: 'es-dar-cuenta', target: 'es', native: 'en', word: 'darse cuenta', sentence: 'Me di cuenta de que había olvidado el libro.', sense: 'to realize or become aware' },
];

const PRACTICE_SAMPLES = [
  { target: 'es', native: 'en', word: 'cerrado', translation: 'closed' },
  { target: 'es', native: 'en', word: 'fácil', translation: 'easy' },
  { target: 'es', native: 'en', word: 'lograr', translation: 'to manage to' },
  { target: 'es', native: 'en', word: 'pendiente', translation: 'pending' },
  { target: 'es', native: 'en', word: 'aunque', translation: 'although' },
  { target: 'es', native: 'en', word: 'aprovechar', translation: 'to make good use of' },
  { target: 'en', native: 'es', word: 'despite', translation: 'a pesar de' },
  { target: 'en', native: 'es', word: 'barely', translation: 'apenas' },
  { target: 'en', native: 'es', word: 'awkward', translation: 'incómodo' },
  { target: 'en', native: 'es', word: 'eventually', translation: 'finalmente' },
  { target: 'en', native: 'es', word: 'troubled', translation: 'preocupado' },
  { target: 'en', native: 'es', word: 'figure out', translation: 'descubrir' },
];

function parseArgs(argv) {
  const options = {
    suite: 'definitions',
    models: ['gemini-3.5-flash-lite', 'gemini-3.5-flash'],
    variants: ['baseline', 'teen'],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--suite') options.suite = argv[++index];
    else if (arg === '--models') options.models = argv[++index].split(',').filter(Boolean);
    else if (arg === '--variants') options.variants = argv[++index].split(',').filter(Boolean);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['definitions', 'practice'].includes(options.suite)) throw new Error('--suite must be definitions or practice');
  return options;
}

function thinkingLevel(model) {
  return model.includes('lite') || model === 'gemini-3.5-flash' ? 'MINIMAL' : 'LOW';
}

function stripFence(value) {
  return String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function parseJson(value) {
  return JSON.parse(stripFence(value));
}

function wordCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function buildDefinitionPrompt(sample, variant) {
  const common = `Target-language word or phrase: "${sample.word}" (${sample.target})
Sentence: "${sample.sentence}"
Learner's native language: ${sample.native}

Return JSON only:
{"translation":"...","definition":"...","part_of_speech":"..."}

The translation and definition must describe the exact meaning used in the sentence.`;
  if (variant === 'baseline') {
    return `${common}
The definition must be in ${sample.native}, brief, and no more than 15 words.
The translation should be 1-4 words.`;
  }
  if (variant === 'teen-v2') {
    return `${common}

Write for a 14-year-old language learner:
- Give the reusable meaning of the word in this sense, not a paraphrase of the whole example sentence.
- The definition must also work in a different sentence using the same sense.
- Use one direct, complete sentence of 6-14 ordinary ${sample.native} words.
- Include the essential difference from other common senses, but nothing more.
- Do not invent a cause, result, intention, intensity, ownership, manner, or object that the word itself does not express.
- Do not begin with "this word", "means", "significa", or similar framing.
- Avoid circular wording, grammar jargon, unnecessary detail, and words harder than the term being explained.
- Give a canonical 1-4 word dictionary translation, not a sentence-specific inflection.
- For verb translations, prefer an infinitive when ${sample.native} normally uses one.
- part_of_speech must be exactly one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle.`;
  }
  if (variant === 'teen-v3') {
    return `${common}

Write for a 14-year-old language learner:
- Define the reusable meaning of the word in this sense, not what happens in the example.
- Use one direct sentence of 5-12 common ${sample.native} words.
- Every detail must be true in every ordinary use of this exact sense.
- Remove details that are merely typical of this example, including force, difficulty, direction, ownership, intention, timing, or physical position unless the word itself requires them.
- Do not compare or contrast this sense with unrelated meanings of the word.
- Prefer familiar everyday words over technical or abstract vocabulary.
- Do not begin with "this word", "means", "significa", or similar framing.
- Avoid circular wording and grammar jargon.
- Give a canonical 1-4 word dictionary translation, not a sentence-specific inflection.
- For verb translations, prefer an infinitive when ${sample.native} normally uses one.
- part_of_speech must be exactly one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle.`;
  }
  if (variant === 'teen-v4') {
    return `${common}

${learnerTranslationRules(sample.native)}
${learnerDefinitionRules(sample.native)}
- part_of_speech must be exactly one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, article, particle.
`;
  }
  return `${common}

Write for a 14-year-old language learner:
- Use ordinary, concrete ${sample.native} words the learner is likely to know.
- Make the definition one complete sentence of 8-16 words.
- Explain what the word means here, not every possible dictionary meaning.
- Be specific enough to distinguish this sense from other common senses.
- Do not use the target word, a close variation of it, or the translation as the definition.
- Avoid grammar jargon, circular wording, unnecessary detail, and words harder than the term being explained.
- The translation must be a natural 1-4 word equivalent in ${sample.native}.
- part_of_speech must be one lowercase English label.`;
}

function buildPracticePrompt(sample) {
  return `Write one NEW, short sentence for a vocabulary exercise in ${sample.target}.

The learner must supply the exact saved word "${sample.word}". Its ${sample.native} meaning is "${sample.translation}".

Rules:
- Use the exact saved word "${sample.word}" once. Do not inflect or replace it.
- Make a natural, standalone sentence of 6-14 words.
- Use an everyday situation familiar to a 14-year-old, such as school, home, friends, hobbies, travel, food, or sports.
- Keep the surrounding vocabulary at an A2-B1 level.
- Use correct spelling, punctuation, and accent marks throughout the sentence.
- Preserve every accent mark in the exact saved word.
- Do not include tildes, blanks, explanations, or markdown.

Return only the sentence. Nothing else.`;
}

function practiceValid(raw, sample) {
  const clean = String(raw || '').trim().replace(/\s+/g, ' ');
  const escaped = sample.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const occurrences = clean.match(new RegExp(`(^|[^\\p{L}\\p{M}])${escaped}(?=$|[^\\p{L}\\p{M}])`, 'giu')) || [];
  const count = wordCount(clean);
  return clean.length > 0 && count >= 6 && count <= 14 && occurrences.length === 1 && !/[~_`]/.test(clean);
}

async function evaluateDefinition(sample, model, variant) {
  const startedAt = Date.now();
  const raw = await callGemini(
    buildDefinitionPrompt(sample, variant),
    {
      thinkingConfig: { thinkingLevel: thinkingLevel(model) },
      maxOutputTokens: 256,
      responseMimeType: 'application/json',
    },
    model,
  );
  const latencyMs = Date.now() - startedAt;
  let parsed = null;
  let parseError = null;
  try {
    parsed = parseJson(raw);
  } catch (error) {
    parseError = error.message;
  }
  const definitionWords = wordCount(parsed?.definition);
  return {
    suite: 'definitions',
    id: sample.id,
    model,
    variant,
    word: sample.word,
    sentence: sample.sentence,
    expectedSense: sample.sense,
    latencyMs,
    output: parsed || raw,
    checks: {
      parseable: Boolean(parsed),
      translationPresent: Boolean(parsed?.translation?.trim()),
      definitionPresent: Boolean(parsed?.definition?.trim()),
      definitionWords,
      withinRequestedLength: variant === 'teen'
        ? definitionWords >= 8 && definitionWords <= 16
        : variant === 'teen-v2'
          ? definitionWords >= 6 && definitionWords <= 14
          : variant === 'teen-v3'
            ? definitionWords >= 5 && definitionWords <= 12
            : variant === 'teen-v4'
              ? definitionWords >= 4 && definitionWords <= 11
          : definitionWords > 0 && definitionWords <= 15,
      partOfSpeechPresent: Boolean(parsed?.part_of_speech?.trim()),
      parseError,
    },
  };
}

async function evaluatePractice(sample, model) {
  const startedAt = Date.now();
  const raw = await callGemini(
    buildPracticePrompt(sample),
    {
      thinkingConfig: { thinkingLevel: thinkingLevel(model) },
      maxOutputTokens: 256,
      responseMimeType: 'text/plain',
    },
    model,
  );
  return {
    suite: 'practice',
    id: `${sample.target}-${sample.word}`,
    model,
    word: sample.word,
    latencyMs: Date.now() - startedAt,
    output: raw.trim(),
    checks: {
      valid: practiceValid(raw, sample),
      words: wordCount(raw),
    },
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
  const options = parseArgs(process.argv.slice(2));
  const results = [];
  if (options.suite === 'definitions') {
    for (const model of options.models) {
      for (const variant of options.variants) {
        for (const sample of DEFINITION_SAMPLES) {
          const result = await evaluateDefinition(sample, model, variant);
          results.push(result);
          console.log(JSON.stringify({ event: 'gemini_routing_evaluation', ...result }));
        }
      }
    }
  } else {
    for (const model of options.models) {
      for (const sample of PRACTICE_SAMPLES) {
        const result = await evaluatePractice(sample, model);
        results.push(result);
        console.log(JSON.stringify({ event: 'gemini_routing_evaluation', ...result }));
      }
    }
  }

  for (const model of options.models) {
    const modelResults = results.filter((result) => result.model === model);
    const valid = modelResults.filter((result) => (
      result.suite === 'practice'
        ? result.checks.valid
        : result.checks.parseable
          && result.checks.translationPresent
          && result.checks.definitionPresent
          && result.checks.withinRequestedLength
    )).length;
    console.log(JSON.stringify({
      event: 'gemini_routing_summary',
      suite: options.suite,
      model,
      samples: modelResults.length,
      valid,
      validRate: valid / Math.max(modelResults.length, 1),
      averageLatencyMs: Math.round(mean(modelResults.map((result) => result.latencyMs))),
    }));
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'gemini_routing_evaluation_failed',
    message: error.message,
  }));
  process.exitCode = 1;
});
