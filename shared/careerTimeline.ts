// An agent's timeline (#205): what they did, from the session history (the records behind the CEO's session_history)
// and the cost ledger's round causes (#188). Each issue they built is one item with its PR, QA rounds, fixes and merge;
// QA reviews they did, fixes on other people's PRs, stops and errors, and rehires are items of their own. The server
// builds it when a profile opens; the profile groups it by the viewer's day. Pure.
import type { CostRecord, SessionOutcome } from './costs.ts';
import { historyId, type HistoryEntry } from './history.ts';
import type { RoundCause } from './rounds.ts';

/** One QA round on their PR. */
interface TimelineRound {
  at: number;
  pass: boolean;
  /** Who tested it. */
  by: string;
  cause: RoundCause | null;
  /** The history entry: tap for its report and transcript. */
  entry: string;
}

interface ItemBase {
  at: number;
  repoId: string;
  pr: number | null;
  title: string;
  usd: number;
  /** Time in sessions (ms). */
  ms: number;
  /** The history entry to open (its session). */
  entry: string;
}

export type TimelineItem =
  | (ItemBase & { type: 'build'; issue: number | null; startedAt: number; rounds: TimelineRound[]; fixes: number; state: 'merged' | 'open' | 'no-pr' })
  | (ItemBase & { type: 'review'; pass: boolean; cause: RoundCause | null })
  | (ItemBase & { type: 'fix'; why: 'qa' | 'checks' | 'conflict' })
  | (ItemBase & { type: 'stop'; outcome: SessionOutcome; note: string })
  | { type: 'rehired'; at: number };

export interface TimelineView {
  items: TimelineItem[]; // newest first
  /** How far back it goes (ms). */
  since: number;
  /** Older items were left out. */
  cut: boolean;
}

export const TIMELINE_DAYS = 30;
const TIMELINE_MAX = 80;
const DAY_MS = 24 * 3_600_000;

const STOPS: SessionOutcome[] = ['error', 'watchdog', 'stopped', 'interrupted', 'limited'];
const key = (repoId: string, pr: number | null) => `${repoId}#${pr}`;

/** Their timeline over the last TIMELINE_DAYS days: `entries` is the whole history (QA rounds and merges are other people's entries). */
export function careerTimeline(o: { entries: readonly HistoryEntry[]; costs: readonly CostRecord[]; agent: { id: string; name: string }; rehired: number[]; now: number }): TimelineView {
  const since = o.now - TIMELINE_DAYS * DAY_MS;
  const name = o.agent.name.toLowerCase();
  const causes = new Map<string, RoundCause>();
  for (const c of o.costs) if (c.type === 'session' && c.cause && c.at >= since) causes.set(historyId(c.at, c.agentId, c.kind), c.cause);
  const recent = o.entries.filter((e) => e.at >= since).sort((a, b) => a.at - b.at);
  const mine = (e: HistoryEntry) => e.agentId === o.agent.id || (!!e.agentId && e.agent.toLowerCase() === name);

  const builds = new Map<string, Extract<TimelineItem, { type: 'build' }>>();
  const items: TimelineItem[] = [];
  for (const e of recent) {
    if (!mine(e) || e.kind === 'merge') continue;
    const base = { at: e.at, repoId: e.repoId, pr: e.pr, title: e.title, usd: e.usd, ms: Math.max(0, e.at - e.startedAt), entry: e.id };
    const own = e.pr !== null ? builds.get(key(e.repoId, e.pr)) : undefined;
    const stopped = STOPS.includes(e.outcome as SessionOutcome);
    if (stopped) items.push({ ...base, type: 'stop', outcome: e.outcome as SessionOutcome, note: e.note });
    if (e.kind === 'issue' || own) {
      if (own) {
        // a resumed build, or a fix on their own PR: part of its item
        own.usd += e.usd;
        own.ms += base.ms;
        if (e.kind.startsWith('fix-')) own.fixes++;
        continue;
      }
      if (stopped && e.pr === null) continue;
      const b = { ...base, type: 'build' as const, issue: e.issue, startedAt: e.startedAt, rounds: [], fixes: 0, state: e.pr === null ? ('no-pr' as const) : ('open' as const) };
      items.push(b);
      if (e.pr !== null) builds.set(key(e.repoId, e.pr), b);
    } else if (e.kind === 'qa' && (e.outcome === 'qa-pass' || e.outcome === 'qa-fail')) {
      items.push({ ...base, type: 'review', pass: e.outcome === 'qa-pass', cause: causes.get(e.id) ?? null });
    } else if (e.kind.startsWith('fix-') && !stopped) {
      items.push({ ...base, type: 'fix', why: e.kind.slice(4) as 'qa' | 'checks' | 'conflict' });
    }
  }
  // Other people's QA rounds on their PRs, and the office's merges of them.
  for (const e of recent) {
    const b = e.pr !== null ? builds.get(key(e.repoId, e.pr)) : undefined;
    if (!b) continue;
    if (e.kind === 'qa' && (e.outcome === 'qa-pass' || e.outcome === 'qa-fail')) {
      b.rounds.push({ at: e.at, pass: e.outcome === 'qa-pass', by: e.agent, cause: causes.get(e.id) ?? null, entry: e.id });
      b.at = Math.max(b.at, e.at);
    } else if (e.kind === 'merge') {
      b.state = 'merged';
      b.at = Math.max(b.at, e.at);
    }
  }
  for (const at of o.rehired) if (at >= since) items.push({ type: 'rehired', at });
  items.sort((a, b) => b.at - a.at);
  return { items: items.slice(0, TIMELINE_MAX), since, cut: items.length > TIMELINE_MAX };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The viewer's local day of `at`, e.g. 2026-11-07. */
function localDay(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface TimelineDay {
  day: string;
  items: TimelineItem[];
  /** What that day's items cost. */
  usd: number;
}

/** The items by day, newest day first, each day's items newest first. */
export function groupByDay(items: readonly TimelineItem[], day: (at: number) => string = localDay): TimelineDay[] {
  const out: TimelineDay[] = [];
  for (const it of [...items].sort((a, b) => b.at - a.at)) {
    const d = day(it.at);
    let g = out.find((x) => x.day === d);
    if (!g) out.push((g = { day: d, items: [], usd: 0 }));
    g.items.push(it);
    if (it.type !== 'rehired') g.usd = Math.round((g.usd + it.usd) * 100) / 100;
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}
