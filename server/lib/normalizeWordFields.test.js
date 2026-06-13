import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeForm, parseFormsValue } from './normalizeWordFields.js';

test('mergeForm adds a missing surface form to an empty/null list', () => {
  assert.equal(mergeForm(null, 'premia'), '["premia"]');
  assert.equal(mergeForm('', 'Premia'), '["premia"]');
});

test('mergeForm appends and lowercases without duplicating', () => {
  assert.equal(mergeForm('["premio","premias"]', 'Premia'), '["premio","premias","premia"]');
  assert.equal(mergeForm('["premia","premio"]', 'premia'), '["premia","premio"]');
});

test('mergeForm understands legacy comma-separated forms', () => {
  assert.equal(mergeForm('premio, premias', 'premia'), '["premio","premias","premia"]');
});

test('mergeForm returns null when there is nothing to store', () => {
  assert.equal(mergeForm(null, ''), null);
  assert.equal(mergeForm(null, '   '), null);
});

test('parseFormsValue normalizes JSON, comma, and array inputs', () => {
  assert.deepEqual(parseFormsValue('["A","b"]'), ['a', 'b']);
  assert.deepEqual(parseFormsValue('A, b ,'), ['a', 'b']);
  assert.deepEqual(parseFormsValue(['A', 'B']), ['a', 'b']);
  assert.deepEqual(parseFormsValue(null), []);
});
