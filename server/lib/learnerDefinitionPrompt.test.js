import assert from 'node:assert/strict';
import test from 'node:test';

import {
  learnerDefinitionRules,
  learnerTranslationRules,
} from './learnerDefinitionPrompt.js';

test('learner definition rules encode the bilingual teen quality criteria', () => {
  const english = learnerDefinitionRules('English');
  const spanish = learnerDefinitionRules('Spanish', {
    field: 'DEFINITION',
    translationField: 'TRANSLATION',
  });

  for (const prompt of [english, spanish]) {
    assert.match(prompt, /14-year-old/);
    assert.match(prompt, /5-11/);
    assert.match(prompt, /reusable core meaning/);
    assert.match(prompt, /selected word or phrase itself/);
    assert.match(prompt, /part of speech/);
    assert.match(prompt, /same-root/);
    assert.match(prompt, /technical or abstract/);
    assert.match(prompt, /Too specific/);
    assert.match(prompt, /Circular/);
    assert.match(prompt, /count the words/);
  }
  assert.match(english, /common English words/);
  assert.match(spanish, /common Spanish words/);
});

test('learner translations request canonical short forms and verb infinitives', () => {
  assert.equal(
    learnerTranslationRules('Spanish'),
    'translation: give a canonical 1-4 word dictionary translation in Spanish; use an infinitive for verbs when natural.',
  );
});
