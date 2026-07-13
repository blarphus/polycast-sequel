import { z } from 'zod';
import { LANGUAGES } from './generated/languages.js';

export const SUPPORTED_LANGUAGE_CODES = Object.freeze(LANGUAGES.map((language) => language.code));
const supported = new Set(SUPPORTED_LANGUAGE_CODES);

export function isSupportedLanguageCode(value) {
  const base = String(value || '').trim().toLowerCase().split('-')[0];
  return supported.has(base);
}

export const supportedLanguageSchema = z.string().trim().refine(
  isSupportedLanguageCode,
  `Language must be one of: ${SUPPORTED_LANGUAGE_CODES.join(', ')}`,
);
