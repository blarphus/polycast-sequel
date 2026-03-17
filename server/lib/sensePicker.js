import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const CACHE_DIR = process.env.MODEL_CACHE_DIR || path.resolve(__dirname, '..', '.model-cache');

let pipeline = null;

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function loadModel() {
  try {
    const { pipeline: createPipeline, env } = await import('@xenova/transformers');
    env.cacheDir = CACHE_DIR;
    // Disable local model check — always use cache dir
    env.allowLocalModels = false;
    pipeline = await createPipeline('feature-extraction', MODEL_ID);
    logger.info('Sense-picker model loaded (%s)', MODEL_ID);
  } catch (err) {
    logger.error({ err }, 'Failed to load sense-picker model');
  }
}

export function isModelReady() {
  return pipeline !== null;
}

export async function pickSense(sentence, word, senses) {
  if (!pipeline) return null;

  const query = `${sentence}`;
  const texts = [query, ...senses.map((s) => `${s.pos}: ${s.gloss}`)];

  const output = await pipeline(texts, { pooling: 'mean', normalize: true });

  const sentenceEmbedding = output[0].data;
  let bestIndex = 0;
  let bestScore = -Infinity;

  for (let i = 0; i < senses.length; i++) {
    const senseEmbedding = output[i + 1].data;
    const score = cosineSimilarity(sentenceEmbedding, senseEmbedding);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}
