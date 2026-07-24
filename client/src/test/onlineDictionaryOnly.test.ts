import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

describe('online-only dictionary', () => {
  it('does not retain an offline request adapter or runtime switch', () => {
    const apiCore = source('../api/core.ts');
    const socket = source('../socket.ts');
    const speech = source('../utils/aiSpeech.ts');

    expect(apiCore).not.toContain('offlineDictionary');
    expect(apiCore).not.toContain('VITE_POLYCAST_OFFLINE');
    expect(socket).not.toContain('polycast.offline.enabled');
    expect(speech).not.toContain('polycast.offline.enabled');
  });
});
