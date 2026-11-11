import { describe, expect, it } from 'vitest';
import { applyViewPatch, viewPatch } from './viewPatch.ts';

interface View {
  a: number;
  list: number[];
  gone?: string;
}

describe('view patches (#491)', () => {
  it('carry the top-level fields that changed, the ones now absent as drop, everything for a view never sent', () => {
    const sent: View = { a: 1, list: [1, 2], gone: 'x' };
    expect(viewPatch(undefined, sent)).toEqual({ set: sent });
    expect(viewPatch(sent, { a: 1, list: [1, 2], gone: 'x' })).toBeNull();
    expect(viewPatch(sent, { a: 2, list: [1, 2] })).toEqual({ set: { a: 2 }, drop: ['gone'] });
  });

  it('apply on what the tab has, or on nothing', () => {
    const base: View = { a: 1, list: [1, 2], gone: 'x' };
    const next: View = { a: 1, list: [3] };
    expect(applyViewPatch(base, viewPatch(base, next)!)).toEqual(next);
    expect(base).toEqual({ a: 1, list: [1, 2], gone: 'x' });
    expect(applyViewPatch(null, viewPatch(undefined, next)!)).toEqual(next);
  });
});
