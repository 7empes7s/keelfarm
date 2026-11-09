import { describe, expect, it } from 'vitest';
import { costBubble, costDays, dayLabel, firstPassBubble, lastDays, pickPoint, pointTone, roundsBubble, stepPoint, TREND_H, TREND_PAD, trendX, trendY } from './trendPoints';
import type { CostDayRow } from '../../../shared/costs';

const WED = new Date(2026, 10, 4, 15, 30); // Wed 4 Nov 2026, local time

describe('picking a day from x', () => {
  const values = [1, 2, null, 4, 5];
  const w = 216; // days 50 px apart from 8 px in
  it('takes the nearest day', () => {
    expect([0, 8, 30, 34, 158, 200, 216].map((x) => pickPoint(x, w, values))).toEqual([0, 0, 0, 1, 3, 4, 4]);
  });
  it('skips days without a value', () => {
    expect(pickPoint(trendX(2, 5, w), w, values)).toBe(1); // as near to day 1 as to day 3: the first wins
    expect(pickPoint(trendX(2, 5, w) + 1, w, values)).toBe(3);
    expect(pickPoint(100, w, [null, null])).toBeNull();
  });
  it('keeps every day inside the edges', () => {
    expect([trendX(0, 30, 150), trendX(29, 30, 150)]).toEqual([TREND_PAD.x, 150 - TREND_PAD.x]);
    const y = trendY([1, 3, null], 1.5);
    expect([y(3), y(1)]).toEqual([TREND_PAD.t, TREND_H - TREND_PAD.b]);
  });
});

describe('stepping with the keys', () => {
  const values = [null, 1, null, 3, 4, null];
  it('moves to the previous or next day with a value, and stops at the ends', () => {
    expect(stepPoint(values, 3, 'ArrowLeft')).toBe(1);
    expect(stepPoint(values, 1, 'ArrowLeft')).toBe(1);
    expect(stepPoint(values, 1, 'ArrowRight')).toBe(3);
    expect(stepPoint(values, 4, 'ArrowRight')).toBe(4);
  });
  it('starts on the latest day, Home and End go to the first and last', () => {
    expect(stepPoint(values, null, 'ArrowLeft')).toBe(4);
    expect(stepPoint(values, null, 'ArrowRight')).toBe(4);
    expect(stepPoint(values, 4, 'Home')).toBe(1);
    expect(stepPoint(values, 1, 'End')).toBe(4);
  });
  it('ignores other keys and empty charts', () => {
    expect(stepPoint(values, 3, 'Enter')).toBeNull();
    expect(stepPoint([null], null, 'ArrowLeft')).toBeNull();
  });
});

describe('the bubble', () => {
  it('names the day', () => {
    expect(dayLabel(WED)).toBe('Wed 4 Nov');
    expect(lastDays(3, WED.getTime()).map(dayLabel)).toEqual(['Mon 2 Nov', 'Tue 3 Nov', 'Wed 4 Nov']);
  });
  it('says the rounds and the first-round pass with the merges', () => {
    expect(roundsBubble(WED, 1.4234, 31)).toBe('Wed 4 Nov · 1.42 rounds · 31 merges');
    expect(roundsBubble(WED, 1, 1)).toBe('Wed 4 Nov · 1.00 rounds · 1 merge');
    expect(firstPassBubble(WED, 0.72, 31)).toBe('Wed 4 Nov · 72% first-round pass · 31 merges');
  });
  it('says the cost per merge', () => {
    expect(costBubble(WED, 3.1, 2)).toBe('Wed 4 Nov · $3.10 per merge · 2 merges');
  });
});

describe('colours and the cost days', () => {
  it('colours each side of the target', () => {
    expect([pointTone(1.5, { value: 1.5, better: 'lower' }), pointTone(1.6, { value: 1.5, better: 'lower' })]).toEqual(['good', 'bad']);
    expect([pointTone(0.7, { value: 0.7, better: 'higher' }), pointTone(0.6, { value: 0.7, better: 'higher' })]).toEqual(['good', 'bad']);
  });
  it('has every day of the window, a gap where the ledger has none', () => {
    const row = (day: string, perMerge: number | null, merges: number) => ({ day, perMerge, merges }) as CostDayRow;
    const days = costDays([row('2026-11-04', 3.1, 2), row('2026-11-02', null, 0)], 3, WED.getTime());
    expect(days.map((d) => [dayLabel(d.day), d.perMerge, d.merges])).toEqual([
      ['Mon 2 Nov', null, 0],
      ['Tue 3 Nov', null, 0],
      ['Wed 4 Nov', 3.1, 2],
    ]);
  });
});
