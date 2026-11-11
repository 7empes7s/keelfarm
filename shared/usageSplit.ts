// Who spent an account's usage window (#409): the office's own sessions on it from the cost ledger (as #334's floor
// shares read it), by floor, agent and kind of task, with the most expensive issues and PRs. Pure, for the usage sheet.

import { kindGroup, type CostSession } from './costs.ts';
import type { AccountView, UsageSlice, UsageSplit, UsageTaskCost } from './types.ts';
import { windowSince } from './usageShares.ts';

const DAY_MS = 24 * 3_600_000;
const ROWS = 4;
const TASKS = 3;

type Line = Pick<CostSession, 'at' | 'usd' | 'account' | 'repoId' | 'agentId' | 'agent' | 'kind' | 'issue' | 'pr'>;

const cents = (n: number) => Math.round(n * 100) / 100;

/** The window a split covers: the account's weekly reading's, else its 5-hour one's, else the last 7 days. */
function splitWindow(a: Pick<AccountView, 'usage'>, now: number): { label: string; since: number } {
  const r = a.usage.find((x) => x.type === 'seven_day') ?? a.usage.find((x) => x.type === 'five_hour');
  if (!r) return { label: 'Last 7 days', since: now - 7 * DAY_MS };
  return { label: r.type === 'seven_day' ? 'This week' : 'Last 5 hours', since: windowSince(r, now) };
}

/** Whether a ledger line ran on the account (lines from before accounts were the built-in Claude login's, as accountSpend says). */
const onAccount = (l: Line, a: Pick<AccountView, 'id' | 'builtIn' | 'cli'>) => (l.account ? l.account === a.id : !!a.builtIn && a.cli === 'claude');

function slices(by: Map<string, { label: string; usd: number; sessions: number }>, total: number): UsageSlice[] {
  return [...by]
    .sort((x, y) => y[1].usd - x[1].usd || x[0].localeCompare(y[0]))
    .slice(0, ROWS)
    .map(([key, v]) => ({ key, ...(v.label ? { label: v.label } : {}), usd: cents(v.usd), sessions: v.sessions, pct: total ? Math.round((v.usd / total) * 100) : 0 }));
}

/** The account's split of its window; null when the office ran nothing on it there. */
export function usageSplit(lines: readonly Line[], a: Pick<AccountView, 'id' | 'builtIn' | 'cli' | 'usage'>, now: number): UsageSplit | null {
  const { label, since } = splitWindow(a, now);
  const floors = new Map<string, { label: string; usd: number; sessions: number }>();
  const agents = new Map<string, { label: string; usd: number; sessions: number }>();
  const kinds = new Map<string, { label: string; usd: number; sessions: number }>();
  const tasks = new Map<string, UsageTaskCost>();
  let usd = 0;
  let sessions = 0;
  const add = (m: Map<string, { label: string; usd: number; sessions: number }>, key: string, name: string, u: number) => {
    const row = m.get(key) ?? { label: name, usd: 0, sessions: 0 };
    row.usd += u;
    row.sessions++;
    m.set(key, row);
  };
  for (const l of lines) {
    if (l.at < since || l.at > now || !onAccount(l, a)) continue;
    const u = l.usd > 0 ? l.usd : 0;
    const group = kindGroup(l.kind);
    usd += u;
    sessions++;
    add(floors, group === 'ceo' ? '' : l.repoId, '', u);
    add(agents, l.agentId, l.agent, u);
    add(kinds, group, '', u);
    if (group === 'ceo' || (l.issue === null && l.pr === null)) continue;
    const key = l.issue === null ? `${l.repoId}#pr${l.pr}` : `${l.repoId}#${l.issue}`; // an issue's builds, QA and fixes are one task
    const t = tasks.get(key) ?? { repoId: l.repoId, issue: l.issue, pr: null, usd: 0, sessions: 0 };
    t.pr ??= l.pr;
    t.usd += u;
    t.sessions++;
    tasks.set(key, t);
  }
  if (!sessions) return null;
  return {
    label,
    since,
    usd: cents(usd),
    sessions,
    floors: slices(floors, usd),
    agents: slices(agents, usd),
    kinds: slices(kinds, usd),
    tasks: [...tasks.values()]
      .sort((x, y) => y.usd - x.usd)
      .slice(0, TASKS)
      .map((t) => ({ ...t, usd: cents(t.usd) })),
  };
}
