import { describe, expect, it } from 'vitest';
import { badgeCount } from './badgeCount';

describe('badgeCount', () => {
  it('shows a count up to 99, then 99+ so the badge keeps its size (#514)', () => {
    expect(badgeCount(1)).toBe('1');
    expect(badgeCount(99)).toBe('99');
    expect(badgeCount(100)).toBe('99+');
    expect(badgeCount(524)).toBe('99+');
  });
});
