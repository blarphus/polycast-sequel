import { Conjugator } from '@jirimracek/conjugate-esp';
import { HttpError } from '../lib/httpErrors.js';
import { normalizeFallbackDiagnostic } from '../lib/fallbackDiagnostics.js';
import logger from '../logger.js';

const conjugator = new Conjugator();

export function conjugateSpanishVerb(verb, region = 'castellano', { correlationId } = {}) {
  const normalizedVerb = String(verb || '').trim().normalize('NFC').toLocaleLowerCase('es');
  const generated = conjugator.conjugateSync(normalizedVerb, region);

  if (typeof generated === 'string' || generated.length === 0) {
    const detail = typeof generated === 'string' ? generated : 'No conjugation returned';
    const diagnostic = normalizeFallbackDiagnostic({
      code: 'spanish_conjugation_unavailable',
      severity: 'warning',
      title: 'Conjugation table unavailable',
      message: `Polycast could not build a labeled conjugation table for “${normalizedVerb}”, so the saved forms remain available instead.`,
      source: 'server.dictionary',
      operation: 'generate-spanish-conjugation',
      pipeline: 'dictionary_forms',
      stage: 'conjugation-generator',
      selectedAction: 'show-saved-forms',
      correlationId,
      detail,
    });
    logger.warn({ fallback: diagnostic }, 'Spanish conjugation fallback used');
    throw new HttpError(422, `No Spanish conjugation table is available for “${normalizedVerb}”.`, {
      code: 'spanish_conjugation_unavailable',
      details: [{ path: 'query.verb', message: detail }],
      fallbackNotices: [diagnostic],
    });
  }

  return {
    verb: normalizedVerb,
    region,
    variants: generated,
  };
}

export const spanishConjugationService = {
  conjugate: conjugateSpanishVerb,
};
