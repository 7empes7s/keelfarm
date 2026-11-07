import { describe, expect, it } from 'vitest';
import { chipRow, CHIP_LIMIT } from './chipRow';

const prs = (n: number) => Array.from({ length: n }, (_, i) => 1069 - i);

describe('chipRow', () => {
  it('shows the first few and counts the rest as "+N more"', () => {
    const row = chipRow(prs(21), false);
    expect(row.shown).toEqual(prs(21).slice(0, CHIP_LIMIT));
    expect(row.more).toBe(21 - CHIP_LIMIT);
  });

  it('shows everything once opened', () => {
    expect(chipRow(prs(21), true)).toEqual({ shown: prs(21), more: 0 });
  });

  it('shows a short row whole, and never "+1 more"', () => {
    expect(chipRow(prs(3), false)).toEqual({ shown: prs(3), more: 0 });
    expect(chipRow(prs(CHIP_LIMIT + 1), false)).toEqual({ shown: prs(CHIP_LIMIT + 1), more: 0 });
    expect(chipRow(prs(CHIP_LIMIT + 2), false).more).toBe(2);
  });

  it('takes its own limit', () => {
    expect(chipRow(prs(10), false, 4)).toEqual({ shown: prs(4), more: 6 });
  });
});
