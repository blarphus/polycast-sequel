import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../auth.js';
import { enrichWord } from '../../enrichWord.js';
import { fetchWiktSenses } from '../../enrichWord.js';
import { translateTextDetailed } from '../../lib/googleTranslate.js';
import { asyncHandler, UpstreamError } from '../../lib/httpErrors.js';
import { validate } from '../../lib/validate.js';
import {
  explainSelectionInContext,
  explainWordInContext,
  resolveDictionaryLookup,
  resolveDictionaryLookupFast,
} from '../../services/wordSemanticsService.js';

const lookupQuery = z.object({
  word: z.string().min(1, 'word is required'),
  sentence: z.string().min(1, 'sentence is required'),
  nativeLang: z.string().min(1, 'nativeLang is required'),
  targetLang: z.string().optional(),
  isNative: z.string().optional(),
  context: z.string().optional(),
});
const explainSelectionBody = z.object({
  selection: z.string().trim().min(1, 'selection is required').max(2000),
  context: z.string().trim().min(1, 'context is required').max(10000),
  nativeLang: z.string().min(1, 'nativeLang is required'),
  targetLang: z.string().optional(),
});
const wiktLookupQuery = z.object({
  word: z.string().min(1, 'word is required'),
  targetLang: z.string().min(1, 'targetLang is required'),
  nativeLang: z.string().min(1, 'nativeLang is required'),
});
const translateBody = z.object({
  sentence: z.string().min(1, 'sentence is required'),
  toLang: z.string().min(1, 'toLang is required'),
  fromLang: z.string().optional(),
});
const enrichBody = z.object({
  word: z.string().min(1, 'word is required'),
  sentence: z.string().min(1, 'sentence is required'),
  nativeLang: z.string().min(1, 'nativeLang is required'),
  targetLang: z.string().optional(),
  senseIndex: z.number().optional(),
  definition: z.string().nullable().optional(),
  part_of_speech: z.string().nullable().optional(),
  definition_source: z.string().nullable().optional(),
  matched_gloss: z.string().nullable().optional(),
});

export function createDictionarySemanticRoutes({
  lookupFast = resolveDictionaryLookupFast,
  lookup = resolveDictionaryLookup,
  explainWord = explainWordInContext,
  explainSelection = explainSelectionInContext,
  wiktSenses = fetchWiktSenses,
  translate = translateTextDetailed,
  enrich = enrichWord,
} = {}) {
  const router = Router();

  router.get('/api/dictionary/lookup', authMiddleware, validate({ query: lookupQuery }), asyncHandler(async (req, res) => {
    const { word, sentence, nativeLang, targetLang, isNative } = req.query;
    if (isNative !== 'true') {
      const fast = await lookupFast({ word, sentence, nativeLang, targetLang, userId: req.userId });
      if (fast) return res.json(fast);
    }
    const result = await lookup({ word, sentence, nativeLang, targetLang, isNative: isNative === 'true' });
    if (isNative !== 'true' && result.definition_source === 'gemini') {
      result.fallback_notices = [
        ...(Array.isArray(result.fallback_notices) ? result.fallback_notices : []),
        {
          code: 'dictionary_wiktionary_miss',
          severity: 'warning',
          title: 'Gemini fallback used',
          message: `No matching Wiktionary definition was available for "${word}", so Polycast used Gemini.`,
          source: 'server.dictionary',
          operation: 'lookup-word',
          correlationId: req.id,
        },
      ];
      req.log.warn({ code: 'dictionary_wiktionary_miss', correlationId: req.id, word }, 'Dictionary semantic fallback used');
    }
    return res.json(result);
  }));

  router.get('/api/dictionary/explain', authMiddleware, validate({ query: lookupQuery }), asyncHandler(async (req, res) => {
    const { word, sentence, nativeLang, targetLang, context } = req.query;
    return res.json(await explainWord({ word, sentence, nativeLang, targetLang, context }));
  }));

  router.post('/api/dictionary/explain-selection', authMiddleware, validate({ body: explainSelectionBody }), asyncHandler(async (req, res) => {
    const { selection, context, nativeLang, targetLang } = req.body;
    return res.json(await explainSelection({ selection, context, nativeLang, targetLang }));
  }));

  router.get('/api/dictionary/wikt-lookup', authMiddleware, validate({ query: wiktLookupQuery }), asyncHandler(async (req, res) => {
    const { word, targetLang, nativeLang } = req.query;
    try {
      const { senses } = await wiktSenses(word.toLowerCase(), targetLang, nativeLang);
      return res.json({ word, senses });
    } catch (cause) {
      throw new UpstreamError('Dictionary lookup failed', { code: 'wiktionary_lookup_failed', cause });
    }
  }));

  router.post('/api/dictionary/translate', authMiddleware, validate({ body: translateBody }), asyncHandler(async (req, res) => {
    const { sentence, fromLang, toLang } = req.body;
    const { translation, detectedSourceLang } = await translate(sentence, fromLang || 'auto', toLang);
    return res.json({ translation, detectedSourceLang });
  }));

  router.post('/api/dictionary/enrich', authMiddleware, validate({ body: enrichBody }), asyncHandler(async (req, res) => {
    const { word, sentence, nativeLang, targetLang, senseIndex, definition, part_of_speech, definition_source, matched_gloss } = req.body;
    return res.json(await enrich(word, sentence, nativeLang, targetLang, senseIndex ?? null, {
      definition, part_of_speech, definition_source, matched_gloss, correlationId: req.id,
    }));
  }));

  return router;
}
