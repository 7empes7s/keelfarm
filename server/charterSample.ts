// The demo's objective log (#105): the made-up cost ledger's issues and merges (costSample.ts) under the floor's
// objectives, with QA's charter checks on its QA rounds, so every number on the Charter tab has something to show.
// The last of three or more objectives only got work over two weeks ago: it shows as stalled. Pure and seeded.
import type { CharterParts, ObjectiveLog } from '../shared/charter.ts';
import type { CheckNote } from '../shared/charterStats.ts';
import type { CostRecord } from '../shared/costs.ts';

const TITLES = ['Tidy the empty state', 'Faster first load', 'Fix a flaky test', 'Keyboard focus ring', 'Clearer error message', 'Smaller bundle', 'Undo for deletes', 'Narrow-screen layout', 'Retry on network errors', 'Settings remembered'];
const DAY_MS = 24 * 3600_000;

export function sampleLog(c: Pick<CharterParts, 'objectives' | 'standards' | 'nonGoals'>, ledger: CostRecord[], now: number, rand: () => number): ObjectiveLog {
  const ids = c.objectives.map((o) => o.id);
  const stale = ids.length >= 3 ? ids.at(-1)! : null;
  const live = stale ? ids.slice(0, -1) : ids;
  const tags: Record<string, string> = {};
  const started = new Map<number, number>();
  for (const r of ledger) if (r.type === 'session' && r.issue !== null) started.set(r.issue, Math.min(r.at, started.get(r.issue) ?? Infinity));
  for (const [issue, at] of started) {
    if (!ids.length || rand() < 0.12) continue; // filed without an objective
    // earlier objectives get more of the work
    const pick = live[Math.min(live.length - 1, Math.floor(rand() * rand() * live.length * 1.6))];
    tags[String(issue)] = stale && now - at > 15 * DAY_MS && rand() < 0.4 ? stale : pick;
  }
  const merged = ledger.flatMap((r) => (r.type === 'merge' ? [{ pr: r.pr, title: TITLES[r.pr % TITLES.length], at: r.at, objective: r.issues.map((i) => tags[String(i)]).find(Boolean) ?? null }] : [])).sort((a, b) => b.at - a.at);
  const checks: CheckNote[] = [];
  for (const r of ledger) {
    if (r.type !== 'session' || r.kind !== 'qa' || r.pr === null) continue;
    const roll = rand();
    if (r.outcome === 'qa-fail' && roll < 0.4 && c.standards.length) checks.push({ at: r.at, pr: r.pr, kind: 'standard', rule: c.standards[Math.floor(rand() * rand() * c.standards.length)] });
    else if (r.outcome === 'qa-fail' && roll < 0.5 && c.nonGoals.length) checks.push({ at: r.at, pr: r.pr, kind: 'nonGoal', rule: c.nonGoals[0] });
    else checks.push({ at: r.at, pr: r.pr, kind: 'ok', rule: '' });
  }
  return { tags, merged, checks: checks.sort((a, b) => b.at - a.at).slice(0, 300) };
}
