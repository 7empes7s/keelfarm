// The time axis of the office's time-series charts (#587; drawn by client/src/ui/TimeChart.tsx): x proportional to
// time, ticks on round local hours with the date at midnight, lines broken where readings are missing, and the y axis
// fitted to the data (percentages never past 100). Pure, so the scale is tested without a browser.

const HOUR = 3_600_000;
/** Fewer readings than this are drawn as points, not lines, and the chart says it is still collecting. */
export const SPARSE_POINTS = 6;
/** The least room between two tick labels, px. */
const TICK_GAP_PX = 48;
const TICK_HOURS = [1, 3, 6, 12, 24];

/** A chart's time axis: the window it covers and the gap between readings that breaks a line. */
export interface TimeAxis {
  at: number[]; // each label's time, oldest first
  from: number;
  to: number;
  gapMs: number;
}

export interface TimeTick {
  at: number;
  text: string;
  midnight: boolean; // a new day: drawn as a date marker
}

/** A timestamp's x on [x0, x1], proportional to its time in [from, to]. */
export function timeX(at: number, from: number, to: number, x0: number, x1: number): number {
  if (to <= from) return (x0 + x1) / 2;
  return x0 + ((at - from) / (to - from)) * (x1 - x0);
}

/** The points drawn as one line each (their indexes): broken at a missing value and where two readings are more than `gapMs` apart. */
export function timeRuns(at: readonly number[], values: readonly (number | null)[], gapMs: number): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  values.forEach((v, j) => {
    const prev = run[run.length - 1];
    if (v === null || (prev !== undefined && at[j] - at[prev] > gapMs)) {
      if (run.length) runs.push(run);
      run = [];
    }
    if (v !== null) run.push(j);
  });
  if (run.length) runs.push(run);
  return runs;
}

const two = (n: number) => String(n).padStart(2, '0');
const dateText = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Ticks on round local hours (every 1, 3, 6, 12 or 24 h, whichever fits `plotW`), each midnight labelled with its date. */
export function timeTicks(from: number, to: number, plotW: number): TimeTick[] {
  if (to <= from) return [];
  const hours = (to - from) / HOUR;
  const step = TICK_HOURS.find((s) => plotW / (hours / s) >= TICK_GAP_PX) ?? 24;
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  if (d.getTime() < from) d.setHours(d.getHours() + 1);
  const out: TimeTick[] = [];
  for (let guard = 0; d.getTime() <= to && guard < 1000; guard++) {
    const h = d.getHours();
    if (h % step === 0) out.push({ at: d.getTime(), text: h === 0 ? dateText(d) : `${two(h)}:00`, midnight: h === 0 });
    d.setHours(h + 1);
  }
  return out;
}

/** A round top for the y axis (1, 2, 2.5 or 5 times a power of ten); percentages stop at 100. */
export function yTop(max: number, pct: boolean): number {
  if (max <= 0) return pct ? 100 : 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const nice = ([1, 2, 2.5, 5, 10].find((m) => m * p >= max) ?? 10) * p;
  return pct ? Math.min(100, nice) : nice;
}

/** The reading nearest a time (binary search over `at`, oldest first), or null when there is none. */
export function nearestAt(at: readonly number[], t: number): number | null {
  if (!at.length) return null;
  let lo = 0;
  let hi = at.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && t - at[lo - 1] < at[lo] - t ? lo - 1 : lo;
}
