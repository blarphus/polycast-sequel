import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('extension tokenizer passes the canonical corpus without dropping text', async () => {
  const source = await readFile(new URL('../shared/textTokens.js', import.meta.url), 'utf8');
  const generated = await readFile(new URL('../generated/transcriptFixtures.js', import.meta.url), 'utf8');
  const context = {};
  vm.runInNewContext(`${generated}\n${source}`, context);
  for (const fixture of context.PolycastTranscriptFixtures.tokenization) {
    const actual = context.PolycastTextTokens.tokenize(fixture.input).map((text) => ({
      text,
      isWord: context.PolycastTextTokens.isWordToken(text),
    }));
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(fixture.tokens)), fixture.name);
    assert.equal(actual.map(({ text }) => text).join(''), fixture.input, fixture.name);
  }
});
