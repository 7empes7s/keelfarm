import { describe, expect, it } from 'vitest';
import { hideSurface, isShowing, showSurface, type Surfaces } from './surfaces';

describe('surfaces (#396)', () => {
  it('a side panel hides its copy while the same page is open elsewhere, and gets it back on close', () => {
    let s: Surfaces = [];
    expect(isShowing(s, 'threads')).toBe(false);
    s = showSurface(s, 'threads', 'sheet');
    expect(isShowing(s, 'threads')).toBe(true);
    expect(isShowing(s, 'memory')).toBe(false);
    s = hideSurface(s, 'sheet');
    expect(isShowing(s, 'threads')).toBe(false);
  });

  it("doesn't count the asker's own copy", () => {
    const s = showSurface([], 'memory', 'column');
    expect(isShowing(s, 'memory', 'column')).toBe(false);
    expect(isShowing(s, 'memory', 'chat')).toBe(true);
  });

  it('keeps one entry per place, the latest last, and leaves the rest when one closes', () => {
    let s = showSurface([], 'threads', 'a');
    s = showSurface(s, 'memory', 'b');
    s = showSurface(s, 'threads', 'a');
    expect(s).toEqual([
      { id: 'memory', by: 'b' },
      { id: 'threads', by: 'a' },
    ]);
    expect(hideSurface(s, 'nobody')).toBe(s);
    expect(hideSurface(s, 'b')).toEqual([{ id: 'threads', by: 'a' }]);
  });
});
