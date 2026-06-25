import crypto from 'node:crypto';
import pool from '../db.js';

export function normalizeSharedWordKey(word) {
  return String(word || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function normalizeSharedDefinition(definition) {
  return String(definition || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function normalizeSharedPartOfSpeech(partOfSpeech) {
  return String(partOfSpeech || '').trim().toLowerCase();
}

export function hashSharedDefinition(definition) {
  return crypto
    .createHash('sha256')
    .update(normalizeSharedDefinition(definition))
    .digest('hex');
}

export function buildSharedEntryKey({ word, target_language, definition, part_of_speech }) {
  const targetLanguage = String(target_language || '').trim().toLowerCase();
  const wordKey = normalizeSharedWordKey(word);
  const normalizedDefinition = normalizeSharedDefinition(definition);
  if (!targetLanguage || !wordKey || !normalizedDefinition) return null;
  return {
    target_language: targetLanguage,
    word_key: wordKey,
    part_of_speech_key: normalizeSharedPartOfSpeech(part_of_speech),
    definition_hash: hashSharedDefinition(definition),
  };
}

export function sharedEntryToEnrichment(entry) {
  if (!entry) return null;
  return {
    word: entry.word,
    translation: entry.translation || '',
    definition: entry.definition || '',
    part_of_speech: entry.part_of_speech || null,
    frequency: entry.frequency ?? null,
    frequency_count: entry.frequency_count ?? null,
    example_sentence: entry.example_sentence ?? null,
    sentence_translation: entry.sentence_translation ?? null,
    image_url: entry.image_url ?? null,
    lemma: entry.lemma ?? null,
    forms: entry.forms ?? null,
    image_term: entry.image_term ?? null,
    shared_entry_id: entry.id,
    compendium_hit: true,
    fallback_notices: [],
  };
}

export async function findSharedEntry({ word, target_language, definition, part_of_speech }, db = pool) {
  const key = buildSharedEntryKey({ word, target_language, definition, part_of_speech });
  if (!key) return null;
  const { rows } = await db.query(
    `UPDATE shared_dictionary_entries
     SET use_count = use_count + 1,
         last_used_at = NOW()
     WHERE target_language = $1
       AND word_key = $2
       AND part_of_speech_key = $3
       AND definition_hash = $4
     RETURNING *`,
    [key.target_language, key.word_key, key.part_of_speech_key, key.definition_hash],
  );
  return rows[0] || null;
}

export async function storeSharedEntry(payload, db = pool) {
  const key = buildSharedEntryKey({
    word: payload.lemma || payload.word,
    target_language: payload.target_language,
    definition: payload.definition,
    part_of_speech: payload.part_of_speech,
  });
  if (!key) return null;

  const { rows } = await db.query(
    `INSERT INTO shared_dictionary_entries (
       target_language, word_key, word, part_of_speech_key, part_of_speech,
       definition_hash, definition, translation, frequency, frequency_count,
       example_sentence, sentence_translation, image_url, image_term, lemma, forms,
       definition_source, matched_gloss, source_sense_index
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     ON CONFLICT (target_language, word_key, part_of_speech_key, definition_hash)
     DO UPDATE SET
       use_count = shared_dictionary_entries.use_count + 1,
       last_used_at = NOW()
     RETURNING *`,
    [
      key.target_language,
      key.word_key,
      payload.lemma || payload.word,
      key.part_of_speech_key,
      payload.part_of_speech || null,
      key.definition_hash,
      payload.definition,
      payload.translation || '',
      payload.frequency ?? null,
      payload.frequency_count ?? null,
      payload.example_sentence ?? null,
      payload.sentence_translation ?? null,
      payload.image_url ?? null,
      payload.image_term ?? null,
      payload.lemma ?? null,
      payload.forms ?? null,
      payload.definition_source ?? null,
      payload.matched_gloss ?? null,
      payload.sense_index ?? null,
    ],
  );
  return rows[0] || null;
}
