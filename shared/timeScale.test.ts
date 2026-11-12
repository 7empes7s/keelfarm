import { describe, expect, it } from 'vitest';
import { nearestAt, timeRuns, timeTicks, timeX, yTop } from './timeScale';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('time scale (#587)', () => {
  it('puts uneven readings at x proportional to their time', () => {
    const from = 0;
    const to = 24 * HOUR;
    const at = [23 * MIN, 31 * MIN, 39 * MIN, 19 * HOUR + 10 * MIN];
    const xs = at.map((t) => timeX(t, from, to, 0, 2400));
    expect(xs.map((x) => Math.round(x * 100) / 100)).toEqual([38.33, 51.67, 65, 1916.67]);
    // 8 minutes is a sliver, ~18.5 hours most of the axis: not the same width
    expect(xs[1] - xs[0]).toBeLessThan((xs[3] - xs[2]) / 100);
  });

  it('breaks the line where readings are more than the gap apart, or missing', () => {
    const at = [0, 10, 20, 90, 100, 110, 120].map((m) => m * MIN);
    expect(timeRuns(at, [1, 2, 3, 4, 5, 6, 7], 25 * MIN)).toEqual([[0, 1, 2], [3, 4, 5, 6]]);
    expect(timeRuns(at, [1, 2, 3, 4, null, 6, 7], 25 * MIN)).toEqual([[0, 1, 2], [3], [5, 6]]);
    expect(timeRuns(at, [1, 2, 3, 4, 5, 6, 7], 120 * MIN)).toEqual([[0, 1, 2, 3, 4, 5, 6]]);
  });

  it('ticks every 6 h on a phone and 3 h on a desktop, with the date at midnight', () => {
    const from = new Date(2026, 10, 11, 14, 20).getTime();
    const to = from + 24 * HOUR;
    const phone = timeTicks(from, to, 220);
    expect(phone.map((t) => t.text)).toEqual(['18:00', 'Nov 12', '06:00', '12:00']);
    expect(phone.filter((t) => t.midnight).map((t) => t.at)).toEqual([new Date(2026, 10, 12).getTime()]);
    expect(timeTicks(from, to, 640).map((t) => t.text)).toEqual(['15:00', '18:00', '21:00', 'Nov 12', '03:00', '06:00', '09:00', '12:00']);
    expect(timeTicks(from, from, 300)).toEqual([]);
  });

  it('fits the y axis to the data, percentages capped at 100', () => {
    expect(yTop(32, true)).toBe(50);
    expect(yTop(140, true)).toBe(100);
    expect(yTop(140, false)).toBe(200);
    expect(yTop(0, true)).toBe(100);
  });

  it('finds the reading nearest a time', () => {
    const at = [0, 10, 30, 100];
    expect([nearestAt(at, -5), nearestAt(at, 4), nearestAt(at, 6), nearestAt(at, 70), nearestAt(at, 500), nearestAt([], 3)]).toEqual([0, 0, 1, 3, 3, null]);
  });
});
