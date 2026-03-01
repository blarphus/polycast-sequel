import React, { useState } from 'react';
import * as api from '../../api';
import type { StreamPostWord, WordOverride } from '../../api';
import ImagePicker from '../ImagePicker';
import WordLookupModal from '../WordLookupModal';
import TemplatePicker from './TemplatePicker';
import { renderTildeHighlight } from '../../utils/tildeMarkup';
import { LANGUAGES } from './languages';

export default function WordListTab({
  defaultTargetLang,
  nativeLang,
  onSubmit,
  initialData,
}: {
  defaultTargetLang: string;
  nativeLang: string;
  onSubmit: (data: { title: string; words: (string | WordOverride)[]; target_language: string }) => Promise<void>;
  initialData?: { title: string; words: StreamPostWord[]; target_language: string };
}) {
  const isEditMode = !!initialData;
  const [title, setTitle] = useState(initialData?.title || '');
  const [targetLang, setTargetLang] = useState(initialData?.target_language || defaultTargetLang);
  const [wordsText, setWordsText] = useState('');
  const [preview, setPreview] = useState<StreamPostWord[] | null>(initialData?.words || null);
  const [lookedUp, setLookedUp] = useState(isEditMode);
  const [looking, setLooking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [translating, setTranslating] = useState(false);
  const [imagePickerIdx, setImagePickerIdx] = useState<number | null>(null);
  const [defPickerIdx, setDefPickerIdx] = useState<number | null>(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  const handleTemplateSelect = async (data: { title: string; words: (string | Record<string, unknown>)[]; language: string }) => {
    setTitle(data.title);
    setTargetLang(data.language);
    setShowTemplatePicker(false);

    // Pre-enriched template: words are objects with a translation field
    const firstWord = data.words[0];
    if (typeof firstWord === 'object' && firstWord !== null && 'translation' in firstWord) {
      const enriched: StreamPostWord[] = (data.words as Record<string, unknown>[]).map((w, i) => ({
        id: `tpl-${i}`,
        post_id: '',
        word: String(w.word ?? ''),
        translation: String(w.translation ?? ''),
        definition: String(w.definition ?? ''),
        part_of_speech: (w.part_of_speech as string) ?? null,
        position: i,
        frequency: (w.frequency as number) ?? null,
        frequency_count: (w.frequency_count as number) ?? null,
        example_sentence: (w.example_sentence as string) ?? null,
        image_url: (w.image_url as string) ?? null,
        lemma: (w.lemma as string) ?? null,
        forms: (w.forms as string) ?? null,
        image_term: (w.image_term as string) ?? null,
      }));
      setPreview(enriched);
      setLookedUp(true);
      setWordsText('');

      // Translate into teacher's native language if not English
      if (nativeLang && nativeLang !== 'en' && !nativeLang.startsWith('en-')) {
        setTranslating(true);
        try {
          const pairs = enriched.map(w => ({ word: w.word, definition: w.definition }));
          const allWords = enriched.map(w => w.word);
          const { translations } = await api.batchTranslateWords(pairs, nativeLang, allWords);
          setPreview(prev => prev
            ? prev.map((w, i) => ({
                ...w,
                translation: translations[i]?.translation ?? w.translation,
                definition: translations[i]?.definition ?? w.definition,
              }))
            : prev);
        } catch (err) {
          console.error('Batch translate failed:', err);
        } finally {
          setTranslating(false);
        }
      }
    } else {
      // Plain string words — current behavior
      setWordsText((data.words as string[]).join('\n'));
      setPreview(null);
      setLookedUp(false);
    }
  };

  const wordLines = wordsText.split('\n').map((w) => w.trim()).filter(Boolean);

  const handleLookup = async () => {
    if (wordLines.length === 0) { setLookupError('Enter at least one word'); return; }
    if (!nativeLang) { setLookupError('Set your native language in Settings first'); return; }
    if (!targetLang) { setLookupError('Select a target language'); return; }
    setLooking(true);
    setLookupError('');
    if (!isEditMode) {
      setLookedUp(false);
      setPreview(null);
    }
    try {
      const result = await api.lookupPostWords(wordLines, nativeLang, targetLang);
      if (isEditMode) {
        // Merge new words into existing preview
        setPreview((prev) => [...(prev || []), ...result.words]);
        setWordsText('');
      } else {
        setPreview(result.words);
      }
      setLookedUp(true);
    } catch (err: any) {
      console.error('lookupPostWords failed:', err);
      setLookupError(err instanceof Error ? err.message : String(err));
    } finally {
      setLooking(false);
    }
  };

  const handleSubmit = async () => {
    if (!preview || preview.length === 0) { setSubmitError('No words to post'); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit({
        title,
        words: preview.map(w => ({
          word: w.word,
          translation: w.translation,
          definition: w.definition,
          part_of_speech: w.part_of_speech ?? null,
          frequency: w.frequency ?? null,
          frequency_count: w.frequency_count ?? null,
          example_sentence: w.example_sentence ?? null,
          image_url: w.image_url ?? null,
          lemma: w.lemma ?? null,
          forms: w.forms ?? null,
        })),
        target_language: targetLang,
      });
    } catch (err: any) {
      console.error('Create word list post failed:', err);
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-post-tab-content">
      {submitError && <div className="auth-error">{submitError}</div>}
      <label className="form-label">Title</label>
      <input
        className="form-input"
        placeholder="e.g. Chapter 3 Vocabulary"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="form-label">Target Language</label>
      <select
        className="form-input"
        value={targetLang}
        onChange={(e) => { setTargetLang(e.target.value); if (!isEditMode) { setLookedUp(false); setPreview(null); } }}
        disabled={isEditMode}
      >
        <option value="">Select language…</option>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.name}</option>
        ))}
      </select>
      {!isEditMode && (
        <button
          className="btn btn-secondary btn-block"
          onClick={() => setShowTemplatePicker(true)}
          style={{ marginBottom: '0.5rem' }}
        >
          Browse Templates
        </button>
      )}
      <label className="form-label">{isEditMode ? 'Add More Words (one per line)' : 'Words (one per line)'}</label>
      <textarea
        className="form-input stream-textarea"
        placeholder={'casa\ncomer\nfeliz'}
        value={wordsText}
        onChange={(e) => { setWordsText(e.target.value); if (!isEditMode) { setLookedUp(false); setPreview(null); } }}
        rows={6}
      />
      {lookupError && <div className="auth-error">{lookupError}</div>}
      <button
        className="btn btn-secondary btn-block"
        disabled={looking || wordLines.length === 0}
        onClick={handleLookup}
        style={{ marginBottom: '1rem' }}
      >
        {looking ? 'Looking up…' : 'Look Up Words'}
      </button>
      {lookedUp && preview && preview.length > 0 && (
        <>
          {translating && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div className="loading-spinner loading-spinner--small" />
              <span>Translating…</span>
            </div>
          )}
          <div className="stream-preview-table">
            <div className="stream-preview-header">
              <span>Image</span>
              <span>Word</span>
              <span>Translation</span>
              <span>Part of speech</span>
              <span />
            </div>
            {preview.map((w, i) => (
              <div key={i} className="stream-preview-row">
                <button
                  className="stream-preview-img-btn"
                  onClick={() => setImagePickerIdx(i)}
                  title="Change image"
                >
                  {w.image_url
                    ? <img src={w.image_url} alt={w.word} />
                    : <span className="stream-preview-img-placeholder" />}
                </button>
                <span className="stream-preview-word">{w.word}</span>
                <span className="stream-preview-translation">
                  <span>{w.translation}</span>
                  <span className="stream-preview-def clickable" onClick={() => setDefPickerIdx(i)}>
                    {w.example_sentence
                      ? renderTildeHighlight(w.example_sentence, 'stream-preview-highlight')
                      : '—'}
                  </span>
                </span>
                <span className="stream-preview-pos">{w.part_of_speech || '—'}</span>
                <button
                  className="btn-small btn-danger"
                  onClick={() => setPreview((prev) => prev ? prev.filter((_, j) => j !== i) : prev)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            className="btn btn-primary btn-block"
            disabled={submitting || translating || preview.length === 0}
            onClick={handleSubmit}
            style={{ marginTop: '1rem' }}
          >
            {submitting
              ? (isEditMode ? 'Saving…' : 'Posting…')
              : (isEditMode ? `Save Word List (${preview.length} words)` : `Post Word List (${preview.length} words)`)}
          </button>
          {imagePickerIdx !== null && (
            <ImagePicker
              initialQuery={preview[imagePickerIdx].image_term || preview[imagePickerIdx].word}
              onSelect={async (url) => {
                setPreview(prev => prev
                  ? prev.map((p, j) => j === imagePickerIdx ? { ...p, image_url: url } : p)
                  : prev);
              }}
              onClose={() => setImagePickerIdx(null)}
            />
          )}
          {defPickerIdx !== null && (
            <WordLookupModal
              targetLang={targetLang}
              nativeLang={nativeLang}
              initialQuery={preview[defPickerIdx].word}
              onPick={async (sense) => {
                const idx = defPickerIdx!;
                const word = preview[idx].word;
                setPreview(prev => prev
                  ? prev.map((p, j) => j === idx
                      ? {
                          ...p,
                          definition: sense.gloss,
                          translation: sense.gloss,
                          part_of_speech: sense.pos || p.part_of_speech,
                          example_sentence: sense.example?.text ?? null,
                        }
                      : p)
                  : prev);
                if (!sense.example?.text) {
                  try {
                    const { example_sentence } = await api.generateExampleSentence(word, targetLang, sense.gloss);
                    setPreview(prev => prev
                      ? prev.map((p, j) => j === idx ? { ...p, example_sentence } : p)
                      : prev);
                  } catch (err) {
                    console.error('Failed to generate example sentence:', err);
                  }
                }
              }}
              onClose={() => setDefPickerIdx(null)}
            />
          )}
        </>
      )}
      {lookedUp && preview && preview.length === 0 && (
        <p className="classwork-empty">All words were removed. Add more words above.</p>
      )}
      {showTemplatePicker && (
        <TemplatePicker
          onSelect={handleTemplateSelect}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}
    </div>
  );
}
