import { describe, expect, it } from 'vitest';
import {
  detectLeadingSilenceSeconds,
  getSilenceTrimOffsetSeconds,
} from '../utils/aiSpeech';

function channelWithSpeech({
  sampleRate = 1000,
  silenceSeconds,
  speechSeconds = 0.2,
}: {
  sampleRate?: number;
  silenceSeconds: number;
  speechSeconds?: number;
}) {
  const silenceSamples = Math.round(sampleRate * silenceSeconds);
  const samples = new Float32Array(
    silenceSamples + Math.round(sampleRate * speechSeconds),
  );
  samples.fill(0.12, silenceSamples);
  return { samples, sampleRate };
}

describe('flashcard leading-silence analysis', () => {
  it('keeps half of the detected dead air before pronunciation', () => {
    const { samples, sampleRate } = channelWithSpeech({ silenceSeconds: 1 });

    expect(detectLeadingSilenceSeconds([samples], sampleRate)).toBeCloseTo(1, 2);
    expect(getSilenceTrimOffsetSeconds([samples], sampleRate)).toBeCloseTo(0.5, 2);
  });

  it('ignores an isolated click before sustained speech', () => {
    const { samples, sampleRate } = channelWithSpeech({ silenceSeconds: 1 });
    samples.fill(0.1, 200, 210);

    expect(getSilenceTrimOffsetSeconds([samples], sampleRate)).toBeCloseTo(0.5, 2);
  });

  it('does not skip audio when no sustained speech is detected', () => {
    const silence = new Float32Array(1500);
    expect(getSilenceTrimOffsetSeconds([silence], 1000)).toBe(0);
  });
});
