import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DictionaryEntryEditor from '../components/DictionaryEntryEditor';
import type { SavedWord } from '../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const entry = {
  id: 'word-1',
  word: 'sacar',
  translation: 'to take out',
  definition: 'remove something',
  target_language: 'es',
  sentence_context: null,
  created_at: '2026-07-24T00:00:00.000Z',
  frequency: 9,
  frequency_count: 100,
  example_sentence: 'Saco la basura.',
  sentence_translation: 'I take out the trash.',
  part_of_speech: 'verb',
  srs_interval: 0,
  due_at: null,
  last_reviewed_at: null,
  correct_count: 0,
  incorrect_count: 0,
  ease_factor: 2.5,
  learning_step: 0,
  image_url: null,
  lemma: 'sacar',
  forms: null,
  prompt_stage: 0,
  priority: false,
  image_term: null,
  queue_position: null,
  introduced_date: null,
  relearning_date: null,
} satisfies SavedWord;

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('DictionaryEntryEditor', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('edits and saves the dictionary fields shown on a flashcard', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    act(() => {
      root.render(<DictionaryEntryEditor entry={entry} onSave={onSave} onClose={onClose} />);
    });

    const inputs = container.querySelectorAll<HTMLInputElement>('input');
    const textareas = container.querySelectorAll<HTMLTextAreaElement>('textarea');
    expect(inputs[0].value).toBe('sacar');
    expect(inputs[1].value).toBe('to take out');

    act(() => {
      setValue(inputs[1], 'to remove');
      setValue(textareas[0], 'take something out of a place');
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>('form')?.requestSubmit();
    });

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      word: 'sacar',
      translation: 'to remove',
      definition: 'take something out of a place',
      part_of_speech: 'verb',
    }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the editor open and explains when the word is blank', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    act(() => {
      root.render(<DictionaryEntryEditor entry={entry} onSave={onSave} onClose={onClose} />);
    });
    const wordInput = container.querySelector<HTMLInputElement>('input')!;
    act(() => setValue(wordInput, '  '));
    await act(async () => {
      container.querySelector<HTMLFormElement>('form')?.requestSubmit();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Word is required.');
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
