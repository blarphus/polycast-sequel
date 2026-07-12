import { describe, expect, it } from 'vitest';
import { TRANSCRIPT_TOKENIZATION_FIXTURES } from '../generated/transcriptFixtures';
import { isWordToken, tokenize } from '../textTokens';
import { parseSrt } from '../utils/srtParser';

describe('canonical transcript/tokenization corpus', () => {
  it('matches every token without dropping punctuation or whitespace', () => {
    for (const fixture of TRANSCRIPT_TOKENIZATION_FIXTURES.tokenization) {
      expect(tokenize(fixture.input).map((text) => ({ text, isWord: isWordToken(text) })), fixture.name)
        .toEqual(fixture.tokens);
    }
  });

  it('parses comma/dot timestamps and skips malformed SRT cues', () => {
    for (const fixture of TRANSCRIPT_TOKENIZATION_FIXTURES.srt) {
      expect(parseSrt(fixture.input).map(({ text, offset, duration }) => ({ text, offset, duration })), fixture.name)
        .toEqual(fixture.segments);
    }
  });
});
