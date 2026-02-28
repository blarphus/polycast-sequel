const NORMALIZATION_ENABLED = process.env.TRANSCRIPT_NORMALIZATION_ENABLED !== 'false';
const NORMALIZATION_PAUSE_MS = Number(process.env.TRANSCRIPT_NORMALIZATION_PAUSE_MS || 2200);
const NORMALIZATION_SOFT_PAUSE_MS = Number(process.env.TRANSCRIPT_NORMALIZATION_SOFT_PAUSE_MS || 900);
const NORMALIZATION_MIN_SENTENCE_WORDS = Number(process.env.TRANSCRIPT_NORMALIZATION_MIN_SENTENCE_WORDS || 8);
const NORMALIZATION_MAX_SENTENCE_WORDS = Number(process.env.TRANSCRIPT_NORMALIZATION_MAX_SENTENCE_WORDS || 30);
const NORMALIZATION_LANGS = new Set(
  String(process.env.TRANSCRIPT_NORMALIZATION_LANGS || 'en,es')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;
const END_PUNCT_RE = /[.!?]["')\]]*$/;
const TRAIL_PUNCT_STRIP_RE = /[.,;:!?]+$/;

const EN_CONTINUATIONS = new Set([
  'and', 'but', 'or', 'so', 'because', 'that', 'which', 'who', 'while', 'when', 'if', 'then',
]);
const ES_CONTINUATIONS = new Set([
  'y', 'e', 'o', 'u', 'pero', 'porque', 'que', 'cuando', 'si', 'aunque', 'mientras',
]);

function baseLanguage(language) {
  return String(language || '')
    .trim()
    .toLowerCase()
    .split('-')[0];
}

function collapseWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function extractWordTokens(text) {
  return Array.from(String(text || '').matchAll(WORD_RE), (m) => m[0]);
}

function sameWordStream(originalWords, normalizedWords) {
  if (originalWords.length !== normalizedWords.length) return false;
  for (let i = 0; i < originalWords.length; i += 1) {
    if (originalWords[i].toLowerCase() !== normalizedWords[i].toLowerCase()) return false;
  }
  return true;
}

function uppercaseFirstLetter(text) {
  const idx = text.search(/\p{L}/u);
  if (idx < 0) return text;
  return `${text.slice(0, idx)}${text[idx].toUpperCase()}${text.slice(idx + 1)}`;
}

function firstWordLower(text) {
  const match = text.match(WORD_RE);
  if (!match) return null;
  return match[0].toLowerCase();
}

function shouldTerminateSegment({
  sentenceWordCount,
  currentText,
  nextText,
  nextOffset,
  currentOffset,
  currentDuration,
  language,
}) {
  if (!currentText) return false;
  if (END_PUNCT_RE.test(currentText)) return true;
  if (!nextText) return true;

  const pauseMs = Math.max(0, Number(nextOffset || 0) - (Number(currentOffset || 0) + Number(currentDuration || 0)));
  if (pauseMs >= NORMALIZATION_PAUSE_MS) return true;

  if (sentenceWordCount >= NORMALIZATION_MAX_SENTENCE_WORDS && pauseMs >= NORMALIZATION_SOFT_PAUSE_MS) {
    return true;
  }

  const nextWord = firstWordLower(nextText);
  if (!nextWord) return true;

  const continuationSet = language === 'es' ? ES_CONTINUATIONS : EN_CONTINUATIONS;
  if (pauseMs >= NORMALIZATION_SOFT_PAUSE_MS && sentenceWordCount >= NORMALIZATION_MIN_SENTENCE_WORDS) {
    return !continuationSet.has(nextWord);
  }

  return false;
}

function normalizeSegmentText({ text, capitalizeStart, addTerminalPeriod }) {
  let out = collapseWhitespace(text);
  if (!out) return out;

  if (capitalizeStart) {
    out = uppercaseFirstLetter(out);
  }

  // Remove trailing punctuation noise, then re-apply deterministic sentence boundary punctuation.
  out = out.replace(TRAIL_PUNCT_STRIP_RE, '');
  if (addTerminalPeriod) {
    out = `${out}.`;
  }

  return out;
}

function normalizeByRules(segments, language) {
  const out = segments.map((seg) => ({ ...seg, text: collapseWhitespace(seg?.text || '') }));
  const sentenceStartIndices = [];
  const sentenceEndIndices = [];
  let windowStart = -1;
  let windowWords = 0;

  for (let i = 0; i < out.length; i += 1) {
    const seg = out[i];
    const next = out[i + 1] || null;

    const rawText = seg.text;
    if (!rawText) {
      continue;
    }

    if (windowStart === -1) {
      windowStart = i;
      sentenceStartIndices.push(i);
      windowWords = 0;
    }

    windowWords += extractWordTokens(rawText).length;
    const addTerminalPeriod = shouldTerminateSegment({
      sentenceWordCount: windowWords,
      currentText: rawText,
      nextText: next?.text || '',
      nextOffset: next?.offset || 0,
      currentOffset: seg?.offset || 0,
      currentDuration: seg?.duration || 0,
      language,
    });

    seg.text = normalizeSegmentText({
      text: rawText,
      capitalizeStart: false,
      addTerminalPeriod: false,
    });

    if (addTerminalPeriod) {
      sentenceEndIndices.push(i);
      windowStart = -1;
      windowWords = 0;
    }
  }

  // Apply sentence-level casing/punctuation after chunk grouping.
  for (const idx of sentenceStartIndices) {
    if (!out[idx]?.text) continue;
    out[idx].text = uppercaseFirstLetter(out[idx].text);
  }

  for (const idx of sentenceEndIndices) {
    if (!out[idx]?.text) continue;
    if (!END_PUNCT_RE.test(out[idx].text)) {
      out[idx].text = `${out[idx].text}.`;
    }
  }

  return out;
}

export function normalizeTranscriptSegmentsStrict(segments, { language } = {}) {
  const src = Array.isArray(segments) ? segments : [];
  if (!NORMALIZATION_ENABLED) {
    return {
      segments: src,
      meta: { applied: false, reason: 'disabled', engine: 'deterministic-v1', language: baseLanguage(language) || '' },
    };
  }

  const lang = baseLanguage(language);
  if (!lang || !NORMALIZATION_LANGS.has(lang)) {
    return {
      segments: src,
      meta: { applied: false, reason: 'unsupported_language', engine: 'deterministic-v1', language: lang || '' },
    };
  }

  const originalWords = src.flatMap((s) => extractWordTokens(s?.text || ''));
  const normalized = normalizeByRules(src, lang);
  const normalizedWords = normalized.flatMap((s) => extractWordTokens(s?.text || ''));

  if (!sameWordStream(originalWords, normalizedWords)) {
    return {
      segments: src,
      meta: { applied: false, reason: 'word_integrity_check_failed', engine: 'deterministic-v1', language: lang },
    };
  }

  let changedSegments = 0;
  for (let i = 0; i < src.length; i += 1) {
    if ((src[i]?.text || '') !== (normalized[i]?.text || '')) changedSegments += 1;
  }

  if (changedSegments === 0) {
    return {
      segments: src,
      meta: { applied: false, reason: 'no_changes', engine: 'deterministic-v1', language: lang, changedSegments: 0 },
    };
  }

  return {
    segments: normalized,
    meta: { applied: true, reason: 'ok', engine: 'deterministic-v1', language: lang, changedSegments },
  };
}
