import { describe, expect, it } from 'vitest';
import { isLong } from './longText';

describe('long chat messages', () => {
  it('fold behind Show more when they are long in characters or lines', () => {
    expect(isLong('A short status.')).toBe(false);
    expect(isLong('word '.repeat(300))).toBe(true);
    expect(isLong(Array.from({ length: 30 }, (_, i) => `- item ${i}`).join('\n'))).toBe(true);
  });
});
