// The demo's made-up careers (#117): a fresh demo office's agents start with records unlike each other (a veteran, a
// reviewer, a rookie, one who needs fixes, a clean shipper), so the profile's stats, floor comparisons, sparkline and
// badges all show.
import { DAY_MS, newCareer, type CareerView } from '../shared/careers.ts';

const MIN = 60_000;
const TITLES = ['Fix the elevator panel on phones', 'Retry flaky webhook deliveries', 'Cache the issue list per floor', 'Dark mode for the kanban', 'Speed up the QA queue', 'Empty states for the Team tab', 'Keep the chat scrolled to the end', 'Stream the cost ledger'];

type Shape = Omit<CareerView, 'since' | 'recent' | 'week' | 'toPr'> & { days: number; weekly: number[]; toPr: number[] };

const SHAPES: Shape[] = [
  { days: 21, opened: 20, merged: 18, firstPass: 12, firstQa: 15, qaPass: 20, qaFail: 4, fixRounds: 3, run: 4, best: 6, reviews: 9, costUsd: 41.3, turns: 2380, weekly: [3, 5, 4, 6], toPr: [38, 52, 41, 47, 35] },
  { days: 12, opened: 4, merged: 3, firstPass: 2, firstQa: 3, qaPass: 3, qaFail: 1, fixRounds: 1, run: 0, best: 2, reviews: 14, costUsd: 9.8, turns: 640, weekly: [0, 1, 1, 1], toPr: [64, 58, 71] },
  { days: 0.1, opened: 0, merged: 0, firstPass: 0, firstQa: 0, qaPass: 0, qaFail: 0, fixRounds: 0, run: 0, best: 0, reviews: 0, costUsd: 0.4, turns: 22, weekly: [0, 0, 0, 0], toPr: [] },
  { days: 9, opened: 9, merged: 7, firstPass: 3, firstQa: 7, qaPass: 8, qaFail: 6, fixRounds: 6, run: 1, best: 2, reviews: 2, costUsd: 24.6, turns: 1510, weekly: [1, 2, 2, 2], toPr: [95, 120, 84, 102] },
  { days: 5, opened: 5, merged: 5, firstPass: 5, firstQa: 5, qaPass: 5, qaFail: 0, fixRounds: 0, run: 5, best: 5, reviews: 3, costUsd: 6.1, turns: 410, weekly: [0, 0, 2, 3], toPr: [31, 28, 36, 30, 33] },
];

/** A record for each of `agentIds`, in turn from the shapes above, dated back from `now`. */
export function sampleCareers(agentIds: string[], now: number): Record<string, CareerView> {
  const out: Record<string, CareerView> = {};
  agentIds.forEach((id, i) => {
    const { days, weekly, toPr, ...counts } = SHAPES[i % SHAPES.length];
    // the fourth week back is the first: spread each week's merges over its days, newest last
    const week = weekly.flatMap((n, w) => Array.from({ length: n }, (_, k) => now - (3 - w) * 7 * DAY_MS - ((k + 1) * 7 * DAY_MS) / (n + 1)));
    const recent = [...week]
      .reverse()
      .slice(0, 5)
      .map((at, k) => ({ n: 100 + i * 5 + (4 - k), title: TITLES[(i + k) % TITLES.length], at }));
    out[id] = { ...newCareer(now - days * DAY_MS), ...counts, week, recent, toPr: toPr.map((m) => m * MIN) };
  });
  return out;
}
