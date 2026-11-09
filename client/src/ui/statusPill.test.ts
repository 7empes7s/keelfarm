import { describe, expect, it } from 'vitest';
import { badgeStatus } from './StatusPill';

describe('badgeStatus', () => {
  it("shows who a waiting agent waits for instead of done, and their status otherwise", () => {
    expect(badgeStatus({ status: 'done', waiting: 'ceo' })).toBe('waiting-ceo');
    expect(badgeStatus({ status: 'done', waiting: 'manager' })).toBe('needs-you');
    expect(badgeStatus({ status: 'working', blocked: 'a prompt' })).toBe('needs-you');
    expect(badgeStatus({ status: 'working', waiting: 'ceo' })).toBe('working'); // answered: back at work
    expect(badgeStatus({ status: 'done', waiting: null })).toBe('idle'); // finished: free (#307)
  });
});
