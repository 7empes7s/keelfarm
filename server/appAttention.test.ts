import { describe, expect, it } from 'vitest';
import { AppAttention } from './appAttention.ts';

describe('AppAttention', () => {
  it('keeps each open tab’s attention, ignores other messages and forgets closed tabs', () => {
    const a = new AppAttention(), tab = { OPEN: 1, readyState: 1 };
    expect(a.receive(tab, JSON.stringify({ type: 'lines' }), 1)).toBe(false);
    expect(a.receive(tab, JSON.stringify({ type: 'attention', visible: true }), 5)).toBe(true);
    expect(a.all()).toEqual([{ visible: true, at: 5 }]);
    tab.readyState = 3;
    expect(a.all()).toEqual([]);
  });

  it('takes a notice’s message once and keeps only the newest 50', () => {
    const a = new AppAttention();
    for (let i = 0; i < 51; i++) a.link(`n${i}`, i);
    expect(a.take(['n0', 'n1', 'n50', 'x'])).toEqual([1, 50]);
    expect(a.take(['n1'])).toEqual([]);
  });
});
