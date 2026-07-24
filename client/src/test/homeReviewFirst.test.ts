import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/pages/Home.tsx'), 'utf8');

describe('student home review priority', () => {
  it('puts the due-today review preview before requests and the welcome banner', () => {
    const reviewPanel = source.indexOf('className="home-review-first"');
    const friendRequests = source.indexOf('<FriendRequests />');
    const welcomeBanner = source.indexOf('className="home-banner"');

    expect(reviewPanel).toBeGreaterThan(0);
    expect(friendRequests).toBeGreaterThan(reviewPanel);
    expect(welcomeBanner).toBeGreaterThan(reviewPanel);
    expect(source).toContain('Start today’s review');
    expect(source).toContain('dueWords.slice(0, 4)');
  });
});
