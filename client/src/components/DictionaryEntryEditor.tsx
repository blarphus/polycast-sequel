import { useCallback, useState } from 'react';
import type { DictionaryEntryUpdate, SavedWord } from '../api';
import { CloseIcon } from './icons';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface Props {
  entry: SavedWord;
  onSave: (data: DictionaryEntryUpdate) => Promise<void>;
  onClose: () => void;
}

const PARTS_OF_SPEECH = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'preposition',
  'conjunction',
  'interjection',
  'article',
  'particle',
];

export default function DictionaryEntryEditor({ entry, onSave, onClose }: Props) {
  const [word, setWord] = useState(entry.word);
  const [translation, setTranslation] = useState(entry.translation);
  const [definition, setDefinition] = useState(entry.definition);
  const [partOfSpeech, setPartOfSpeech] = useState(entry.part_of_speech ?? '');
  const [exampleSentence, setExampleSentence] = useState(entry.example_sentence ?? '');
  const [sentenceTranslation, setSentenceTranslation] = useState(entry.sentence_translation ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const closeOnEscape = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);
  useEscapeKey(closeOnEscape);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedWord = word.trim();
    if (!trimmedWord) {
      setError('Word is required.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSave({
        word: trimmedWord,
        translation: translation.trim(),
        definition: definition.trim(),
        part_of_speech: partOfSpeech || null,
        example_sentence: exampleSentence.trim() || null,
        sentence_translation: sentenceTranslation.trim() || null,
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this dictionary entry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flashcard-entry-editor-overlay"
      onMouseDown={(event) => {
        if (!saving && event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="flashcard-entry-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flashcard-entry-editor-title"
        onSubmit={submit}
      >
        <header>
          <div>
            <span>Flashcard dictionary entry</span>
            <h2 id="flashcard-entry-editor-title">Edit {entry.word}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close editor">
            <CloseIcon size={20} />
          </button>
        </header>

        <div className="flashcard-entry-editor-fields">
          <label>
            <span>Word</span>
            <input value={word} onChange={(event) => setWord(event.target.value)} autoFocus />
          </label>

          <label>
            <span>Part of speech</span>
            <select value={partOfSpeech} onChange={(event) => setPartOfSpeech(event.target.value)}>
              <option value="">Not specified</option>
              {PARTS_OF_SPEECH.map((part) => (
                <option value={part} key={part}>{part}</option>
              ))}
            </select>
          </label>

          <label className="flashcard-entry-editor-wide">
            <span>Translation</span>
            <input value={translation} onChange={(event) => setTranslation(event.target.value)} />
          </label>

          <label className="flashcard-entry-editor-wide">
            <span>Meaning</span>
            <textarea rows={3} value={definition} onChange={(event) => setDefinition(event.target.value)} />
          </label>

          <label className="flashcard-entry-editor-wide">
            <span>Example sentence</span>
            <textarea rows={2} value={exampleSentence} onChange={(event) => setExampleSentence(event.target.value)} />
          </label>

          <label className="flashcard-entry-editor-wide">
            <span>Example translation</span>
            <textarea rows={2} value={sentenceTranslation} onChange={(event) => setSentenceTranslation(event.target.value)} />
          </label>
        </div>

        {error && <div className="flashcard-entry-editor-error" role="alert">{error}</div>}

        <footer>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </form>
    </div>
  );
}
