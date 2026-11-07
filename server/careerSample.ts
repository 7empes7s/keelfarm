// The demo's made-up careers (#117, #205): a fresh demo office's agents start with records unlike each other (a veteran
// rehired twice, a reviewer, a rookie, one who needs fixes, a clean shipper), so the profile's stats, floor comparisons,
// sparklines, badges and the Team tab's highlights all show; someone let go waits under "Past agents"; and the made-up
// cost ledger becomes two weeks of session history, so every profile has a timeline.
import { DAY_MS, newCareer, weekOf, weekRow, WEEK_MS, type CareerView, type PastCareer, type WeekRow } from '../shared/careers.ts';
import type { CostRecord } from '../shared/costs.ts';
import { historyId, type HistoryEntry } from '../shared/history.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const TITLES = ['Fix the elevator panel on phones', 'Retry flaky webhook deliveries', 'Cache the issue list per floor', 'Dark mode for the kanban', 'Speed up the QA queue', 'Empty states for the Team tab', 'Keep the chat scrolled to the end', 'Stream the cost ledger'];

type Shape = Pick<CareerView, 'opened' | 'merged' | 'firstPass' | 'firstQa' | 'qaPass' | 'qaFail' | 'fixRounds' | 'run' | 'best' | 'reviews' | 'costUsd' | 'turns'> & {
  days: number;
  /** Merges a week, the last 8 weeks, oldest first. */
  weekly: number[];
  toPr: number[];
  /** Hours a day in sessions, and the share of spend wasted. */
  busy: number;
  waste: number;
  /** Earlier stints: days served before, and rehires (days ago). */
  served?: number;
  rehired?: number[];
  rig: [string, string, string];
};

const SHAPES: Shape[] = [
  { days: 6, served: 15, rehired: [6, 13], opened: 20, merged: 18, firstPass: 12, firstQa: 15, qaPass: 20, qaFail: 4, fixRounds: 3, run: 4, best: 6, reviews: 9, costUsd: 41.3, turns: 2380, weekly: [1, 2, 2, 1, 3, 5, 4, 6], toPr: [38, 52, 41, 47, 35], busy: 6, waste: 0.08, rig: ['claude', 'claude-opus-5-5', 'high'] },
  { days: 12, opened: 4, merged: 3, firstPass: 2, firstQa: 3, qaPass: 3, qaFail: 1, fixRounds: 1, run: 0, best: 2, reviews: 14, costUsd: 9.8, turns: 640, weekly: [0, 0, 0, 0, 0, 1, 1, 1], toPr: [64, 58, 71], busy: 3, waste: 0.04, rig: ['claude', 'claude-sonnet-5', 'medium'] },
  { days: 0.1, opened: 0, merged: 0, firstPass: 0, firstQa: 0, qaPass: 0, qaFail: 0, fixRounds: 0, run: 0, best: 0, reviews: 0, costUsd: 0.4, turns: 22, weekly: [0, 0, 0, 0, 0, 0, 0, 0], toPr: [], busy: 1, waste: 0, rig: ['codex', 'gpt-5.5', 'medium'] },
  { days: 9, opened: 9, merged: 7, firstPass: 3, firstQa: 7, qaPass: 8, qaFail: 6, fixRounds: 6, run: 1, best: 2, reviews: 2, costUsd: 24.6, turns: 1510, weekly: [0, 0, 0, 0, 1, 2, 2, 2], toPr: [95, 120, 84, 102], busy: 5, waste: 0.27, rig: ['claude', 'claude-opus-5-5', 'max'] },
  { days: 5, opened: 5, merged: 5, firstPass: 5, firstQa: 5, qaPass: 5, qaFail: 0, fixRounds: 0, run: 5, best: 5, reviews: 3, costUsd: 6.1, turns: 410, weekly: [0, 0, 0, 0, 0, 0, 2, 3], toPr: [31, 28, 36, 30, 33], busy: 2, waste: 0, rig: ['claude', 'claude-sonnet-5', 'low'] },
];

/** The weeks behind a shape since they first joined: merges as given, its spend spread over them, first rounds following its pass rate. */
function sampleWeeks(s: Shape, now: number): WeekRow[] {
  const total = s.weekly.reduce((a, b) => a + b, 0) || 1;
  const rate = s.firstQa ? s.firstPass / s.firstQa : 0;
  const top = weekOf(now);
  return s.weekly.flatMap((merged, i) => {
    const usd = Math.round(((s.costUsd * Math.max(merged, 0.2)) / total) * 100) / 100;
    const weeksAgo = s.weekly.length - 1 - i;
    if (s.days + (s.served ?? 0) < 7 * weeksAgo) return []; // before they joined
    return [weekRow({ w: top - weeksAgo, merged, usd, waste: Math.round(usd * s.waste * 100) / 100, sessions: merged * 3 + 1, firstQa: merged, firstPass: Math.round(merged * rate), min: s.busy * 5 * 60 })];
  });
}

/** A record for each of `agentIds`, in turn from the shapes above, dated back from `now`. */
export function sampleCareers(agentIds: string[], now: number): Record<string, CareerView> {
  const out: Record<string, CareerView> = {};
  agentIds.forEach((id, i) => {
    const s = SHAPES[i % SHAPES.length];
    // the last four weeks' merges, spread over each week's days, newest last; the career keeps the last 7 days'
    const merges = s.weekly.slice(-4).flatMap((n, w) => Array.from({ length: n }, (_, k) => now - (3 - w) * 7 * DAY_MS - ((k + 1) * 7 * DAY_MS) / (n + 1)));
    const week = merges.filter((t) => t > now - WEEK_MS);
    const recent = [...merges]
      .reverse()
      .slice(0, 5)
      .map((at, k): [number, string, number] => [100 + i * 5 + (4 - k), TITLES[(i + k) % TITLES.length], at]);
    const tenure = (s.days + (s.served ?? 0)) * DAY_MS;
    const workMs = Math.round((tenure / DAY_MS) * s.busy * HOUR * 0.7);
    const sessions = Math.max(1, s.opened * 3 + s.reviews);
    out[id] = {
      ...newCareer(now - s.days * DAY_MS),
      opened: s.opened,
      merged: s.merged,
      firstPass: s.firstPass,
      firstQa: s.firstQa,
      qaPass: s.qaPass,
      qaFail: s.qaFail,
      fixRounds: s.fixRounds,
      run: s.run,
      best: s.best,
      reviews: s.reviews,
      costUsd: s.costUsd,
      turns: s.turns,
      week,
      recent,
      toPr: s.toPr.map((m) => m * MIN),
      toMerge: s.toPr.map((m) => Math.round((m * 2.6 + 25) * MIN)),
      hires: 1 + (s.rehired?.length ?? 0),
      rehired: (s.rehired ?? []).map((d) => now - d * DAY_MS),
      served: (s.served ?? 0) * DAY_MS,
      sessions,
      wasted: Math.round(sessions * s.waste),
      wasteUsd: Math.round(s.costUsd * s.waste * 100) / 100,
      workMs,
      weeks: sampleWeeks(s, now),
      rig: [...s.rig, now - Math.min(s.days, 4) * DAY_MS],
    };
  });
  return out;
}

/** Someone the demo office let go last week, under the Team tab's "Past agents"; hire a "Grace" and her record comes back. */
export function samplePastCareers(now: number): Record<string, PastCareer> {
  const left = now - 8 * DAY_MS;
  const career = sampleCareers(['grace'], left).grace; // her record as it stood when she left
  return { grace: { name: 'Grace', id: 'grace-demo', left, career: { ...career, served: career.served + (left - career.since) } } };
}

/**
 * The made-up cost ledger's last two weeks as session history: each session an entry (QA's verdicts with a line on
 * why), each merge the office's entry, so profiles have timelines and the History tab has rows.
 */
export function sampleHistory(records: readonly CostRecord[], repos: readonly { id: string; fullName: string; floor: number }[], now: number): HistoryEntry[] {
  const since = now - 14 * DAY_MS;
  const repo = (id: string) => repos.find((r) => r.id === id);
  const titleOf = (issue: number | null, pr: number | null) => TITLES[((issue ?? pr ?? 0) * 7) % TITLES.length];
  const prIssue = new Map<string, number | null>();
  const out: HistoryEntry[] = [];
  for (const r of records) {
    if (r.at < since) continue;
    const where = repo(r.repoId);
    const common = { repoId: r.repoId, repo: where?.fullName ?? '', floor: where?.floor ?? null, sessionId: null, transcript: null };
    if (r.type === 'merge') {
      out.push({ ...common, id: historyId(r.at, '', 'merge'), at: r.at, startedAt: r.at, agentId: '', agent: 'The office', kind: 'merge', issue: r.issues[0] ?? null, pr: r.pr, title: titleOf(r.issues[0] ?? null, r.pr), outcome: 'merged', note: '', usd: 0, tokens: null, model: '', effort: '' });
      continue;
    }
    if (r.pr !== null && r.issue !== null) prIssue.set(`${r.repoId}#${r.pr}`, r.issue);
    const issue = r.issue ?? (r.pr !== null ? (prIssue.get(`${r.repoId}#${r.pr}`) ?? null) : null);
    const note = r.outcome === 'qa-fail' ? 'The form overflows at 390 px and the new test is missing.' : r.outcome === 'qa-pass' ? 'Works as asked; checked at 390 and 1280 px.' : r.outcome === 'error' ? 'npm test exited 1' : '';
    out.push({ ...common, id: historyId(r.at, r.agentId, r.kind), at: r.at, startedAt: r.at - r.ms, agentId: r.agentId, agent: r.agent, kind: r.kind, issue, pr: r.pr, title: titleOf(issue, r.pr), outcome: r.outcome, note, usd: r.usd, tokens: r.tokens, model: r.model, effort: r.effort });
  }
  return out;
}
