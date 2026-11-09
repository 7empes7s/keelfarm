import { fmtPct, fmtUsd } from '../ops';
import type { CostDayRow } from '../../../shared/costs';
import { dayKey } from '../../../shared/journal';

// Mission control's trend charts (#325; TrendChart.tsx draws them): where a day sits, which day a tap or drag picks,
// the arrow keys' steps, the colours against a target and the bubble's words. Pure, so they're tested on their own.

export const TREND_H = 64;
export const TREND_PAD = { x: 8, t: 10, b: 8 }; // room for the dots and the selected one's ring: nothing touches the edge

type Values = (number | null)[];

/** Where day i of n sits across a chart w px wide. */
export function trendX(i: number, n: number, w: number): number {
  const span = w - 2 * TREND_PAD.x;
  return TREND_PAD.x + (n <= 1 ? span / 2 : (span * i) / (n - 1));
}

/** The height of a value, with the target inside the range so its line always shows. */
export function trendY(values: Values, target: number | null): (v: number) => number {
  const all = [...values.filter((v): v is number => v !== null), ...(target === null ? [] : [target])];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const plot = TREND_H - TREND_PAD.t - TREND_PAD.b;
  return (v) => (max === min ? TREND_H / 2 : TREND_PAD.t + (1 - (v - min) / (max - min)) * plot);
}

/** The day with a value nearest to x (px from the chart's left edge), or null when no day has one. */
export function pickPoint(x: number, w: number, values: Values): number | null {
  let best: number | null = null;
  let dist = Infinity;
  values.forEach((v, i) => {
    const d = Math.abs(trendX(i, values.length, w) - x);
    if (v !== null && d < dist) [best, dist] = [i, d];
  });
  return best;
}

/** The day a key moves to: ← and → the previous or next day with a value (from none, the latest), Home and End the
 * first and last. Null for any other key. */
export function stepPoint(values: Values, from: number | null, key: string): number | null {
  const has = values.flatMap((v, i) => (v === null ? [] : [i]));
  if (!has.length) return null;
  const last = has[has.length - 1];
  if (key === 'Home') return has[0];
  if (key === 'End') return last;
  if (key === 'ArrowLeft') return from === null ? last : (has.filter((i) => i < from).pop() ?? has[0]);
  if (key === 'ArrowRight') return from === null ? last : (has.find((i) => i > from) ?? last);
  return null;
}

/** A value against its target: good on the right side of it (or on it), bad on the wrong one. */
export const pointTone = (v: number, target: { value: number; better: 'lower' | 'higher' }): 'good' | 'bad' => ((target.better === 'lower' ? v <= target.value : v >= target.value) ? 'good' : 'bad');

// ---------- days ----------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue 4 Nov". */
export const dayLabel = (d: Date) => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

/** The last n local days up to the one of `now`, oldest first. */
export function lastDays(n: number, now: number): Date[] {
  const t = new Date(now);
  return Array.from({ length: n }, (_, i) => new Date(t.getFullYear(), t.getMonth(), t.getDate() - (n - 1 - i)));
}

/** The cost card's days: every day of the window, oldest first, with its cost per merge and merges (none on a day
 * without a ledger line). */
export function costDays(byDay: CostDayRow[], days: number, now: number): { day: Date; perMerge: number | null; merges: number }[] {
  return lastDays(days, now).map((day) => {
    const row = byDay.find((d) => d.day === dayKey(day.getTime()));
    return { day, perMerge: row?.perMerge ?? null, merges: row?.merges ?? 0 };
  });
}

// ---------- the bubble ----------

const merges = (n: number) => `${n} merge${n === 1 ? '' : 's'}`;

/** "Tue 4 Nov · 1.42 rounds · 31 merges": the week up to that day. */
export const roundsBubble = (day: Date, perMerge: number, n: number) => `${dayLabel(day)} · ${perMerge.toFixed(2)} rounds · ${merges(n)}`;

/** "Tue 4 Nov · 72% first-round pass · 31 merges". */
export const firstPassBubble = (day: Date, share: number, n: number) => `${dayLabel(day)} · ${fmtPct(share)} first-round pass · ${merges(n)}`;

/** "Tue 4 Nov · $3.10 per merge · 2 merges". */
export const costBubble = (day: Date, perMerge: number, n: number) => `${dayLabel(day)} · ${fmtUsd(perMerge)} per merge · ${merges(n)}`;
