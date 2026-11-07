import { describe, expect, it } from 'vitest';
import { keepsFollowing } from './chatFollow';

describe('the chat following its end', () => {
  it('follows at the end', () => {
    expect(keepsFollowing(false, 500, 500, true)).toBe(true);
    expect(keepsFollowing(true, 300, 500, true)).toBe(true);
  });

  it('keeps following when the log shrinks off the end without scrolling up (the keyboard opening)', () => {
    expect(keepsFollowing(true, 500, 500, false)).toBe(true);
    expect(keepsFollowing(true, 520, 500, false)).toBe(true);
  });

  it('stops following when the manager scrolls up', () => {
    expect(keepsFollowing(true, 480, 500, false)).toBe(false);
  });

  it("doesn't start following on a scroll down that stops short of the end", () => {
    expect(keepsFollowing(false, 520, 500, false)).toBe(false);
  });
});
