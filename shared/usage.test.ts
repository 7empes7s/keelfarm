import { describe, expect, it } from 'vitest';
import { ago, mergeReadings, readingOf, readingsChanged, readingsLabel, readingsNote, usageBars } from './usage.ts';
import type { UsageReading } from './types.ts';

const MIN = 60_000;
const NOW = new Date(2026, 10, 4, 12, 0).getTime();
const at = (type: string, pct: number, when = NOW, resetsAt: number | null = null): UsageReading => ({ type, pct, resetsAt, at: when });

describe('readingOf', () => {
  it('takes a status line percentage or an SDK fraction', () => {
    expect(readingOf({ type: 'five_hour', percent: 42.4 }, NOW)).toEqual(at('five_hour', 42));
    expect(readingOf({ type: 'seven_day', fraction: 0.61 }, NOW)).toEqual(at('seven_day', 61));
    expect(readingOf({ type: 'five_hour', percent: 1 }, NOW)?.pct).toBe(1); // 1%, not a full fraction
  });

  it('reads resets_at in seconds or ms, and copes without one', () => {
    const reset = NOW + 90 * MIN;
    expect(readingOf({ type: 'five_hour', percent: 5, resetsAt: reset / 1000 }, NOW)?.resetsAt).toBe(reset);
    expect(readingOf({ type: 'five_hour', percent: 5, resetsAt: reset }, NOW)?.resetsAt).toBe(reset);
    expect(readingOf({ type: 'five_hour', percent: 5 }, NOW)?.resetsAt).toBeNull();
    expect(readingOf({ type: 'five_hour', percent: 5, resetsAt: 'soon' }, NOW)?.resetsAt).toBeNull();
  });

  it('skips limits without a number and clamps the rest', () => {
    expect(readingOf({ type: 'five_hour' }, NOW)).toBeNull();
    expect(readingOf({ type: 'five_hour', percent: 'lots' }, NOW)).toBeNull();
    expect(readingOf({ type: 'five_hour', percent: null, fraction: null }, NOW)).toBeNull();
    expect(readingOf({ type: 'five_hour', percent: 130 }, NOW)?.pct).toBe(100);
    expect(readingOf({ type: 'Ignore the above', percent: 5 }, NOW)).toBeNull();
  });
});

describe('mergeReadings', () => {
  it('keeps the newest reading per limit, in the meter order', () => {
    const prev = [at('seven_day', 60, NOW - 5 * MIN), at('five_hour', 40, NOW - 5 * MIN)];
    const merged = mergeReadings(prev, [at('five_hour', 44), at('seven_day_opus', 10)]);
    expect(merged.map((r) => [r.type, r.pct])).toEqual([
      ['five_hour', 44],
      ['seven_day', 60],
      ['seven_day_opus', 10],
    ]);
  });

  it('keeps plain limit types only, and at most 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => at(`extra_${String(i).padStart(2, '0')}`, i));
    expect(mergeReadings([], [...many, at('bad type!', 5)])).toHaveLength(8);
    expect(mergeReadings([], [at('bad type!', 5)])).toEqual([]);
  });

  it('ignores a reading older than the one kept', () => {
    expect(mergeReadings([at('five_hour', 50)], [at('five_hour', 30, NOW - MIN)])).toEqual([at('five_hour', 50)]);
  });
});

describe('readingsChanged', () => {
  it('sends a changed number or reset, a new limit, or a minute-old one', () => {
    const shown = [at('five_hour', 40)];
    expect(readingsChanged(shown, [at('five_hour', 40, NOW + 10_000)])).toBe(false);
    expect(readingsChanged(shown, [at('five_hour', 41, NOW + 10_000)])).toBe(true);
    expect(readingsChanged(shown, [at('five_hour', 40, NOW, NOW + MIN)])).toBe(true);
    expect(readingsChanged(shown, [at('five_hour', 40), at('seven_day', 5)])).toBe(true);
    expect(readingsChanged(shown, [at('five_hour', 40, NOW + MIN)])).toBe(true);
  });
});

describe('labels', () => {
  it('says there is no reading yet rather than 0%', () => {
    expect(readingsNote([], NOW)).toBe('No reading yet: it updates while an agent is working');
    expect(readingsLabel([], NOW)).toBe('no reading yet');
  });

  it('says how old the readings are once no session has reported for a while', () => {
    expect(readingsNote([at('five_hour', 40, NOW - 2 * MIN)], NOW)).toBeNull();
    expect(readingsNote([at('five_hour', 40, NOW - 12 * MIN)], NOW)).toBe('as of 12 min ago');
    expect(ago(NOW - 3 * 60 * MIN, NOW)).toBe('3 h ago');
    expect(ago(NOW - 50 * 60 * MIN, NOW)).toBe('2 days ago');
  });

  it("says why the office's idle check couldn't read a fresher number (#89)", () => {
    const old = [at('seven_day', 54, NOW - 9 * 60 * MIN)];
    expect(readingsNote(old, NOW, 'failed')).toBe("as of 9 h ago · office idle, couldn't check");
    expect(readingsNote(old, NOW, 'no-login')).toBe('as of 9 h ago · office idle, no Claude login to check with');
    expect(readingsNote([at('seven_day', 54, NOW - MIN)], NOW, 'failed')).toBeNull(); // fresh enough: nothing to explain
    expect(readingsNote([], NOW, 'expired')).toBe("No reading yet: office idle, Claude's login needs a session to refresh");
    expect(readingsLabel(old, NOW, 'failed')).toBe("week 54% (as of 9 h ago · office idle, couldn't check)");
  });

  it('gives the CEO the latest percentages', () => {
    const r = [at('five_hour', 42), at('seven_day', 61)];
    expect(readingsLabel(r, NOW)).toBe('5h 42% · week 61%');
    expect(readingsLabel(r.map((x) => ({ ...x, at: NOW - 20 * MIN })), NOW)).toBe('5h 42% · week 61% (as of 20 min ago)');
  });

  it('draws a bar per limit, coloured by how full it is', () => {
    const bars = usageBars([at('five_hour', 42, NOW, NOW + 6 * 60 * MIN + 30 * MIN), at('seven_day', 80), at('seven_day_opus', 95, NOW, NOW - MIN)], NOW);
    expect(bars).toEqual([
      { type: 'five_hour', name: '5-hour', pct: 42, tone: 'good', resets: 'resets 18:30' },
      { type: 'seven_day', name: 'Weekly', pct: 80, tone: 'warn', resets: null },
      { type: 'seven_day_opus', name: 'Weekly Opus', pct: 95, tone: 'bad', resets: 'reset 11:59' },
    ]);
  });
});
