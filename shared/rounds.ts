// Why rounds fail (#188): the cause each failed QA round and fix session records, who sets it, and Mission control's
// Rounds card (rounds per merge, first-round pass rate, failed rounds by cause) from the cost ledger. Pure, shared by
// the server (the ledger, company_status) and the client (the card).
import type { CostMerge, CostRecord, CostSession } from './costs.ts';

/** Why a round failed. QA picks bug, nit, spec-missing or lab-error in its report; the office sets conflict, checks and outage. */
export type RoundCause = 'bug' | 'nit' | 'conflict' | 'checks' | 'lab-error' | 'outage' | 'spec-missing';

export const ROUND_CAUSES: RoundCause[] = ['bug', 'nit', 'spec-missing', 'conflict', 'checks', 'lab-error', 'outage'];

export const ROUND_CAUSE_LABELS: Record<RoundCause, string> = {
  bug: 'Bug',
  nit: 'Nit',
  'spec-missing': 'Test missing',
  conflict: 'Conflict',
  checks: 'CI red',
  'lab-error': 'Lab error',
  outage: 'CI outage',
};

export const isRoundCause = (x: unknown): x is RoundCause => ROUND_CAUSES.includes(x as RoundCause);

/** Not the PR's fault: left out of rounds per merge and the first-round pass rate, and shown apart. */
export const excludedCause = (c: RoundCause | null | undefined) => c === 'lab-error' || c === 'outage';

/** O2's targets: first-round pass rate at least this, rounds per merge at most this. */
export const O2_FIRST_PASS = 0.7;
export const O2_ROUNDS_PER_MERGE = 1.5;

// ---------- who sets it ----------

/** GitHub refusing to run the jobs at all (billing, spending limit, no runner): CI never started. */
const OUTAGE = /not started|never started|billing|spending limit|account (is )?locked|no runner|exceeded .*minutes/i;

/** A red check's cause from its failure text: an outage when CI never started, else checks. */
export const checksCause = (text: string | null | undefined): RoundCause => (text && OUTAGE.test(text) ? 'outage' : 'checks');

/** A failed QA round's cause: QA's pick, else a conflict or red checks the office sees on the PR, else a bug. */
export function qaCause(reported: unknown, pull: { mergeable?: string; mergeState?: string; checks?: string } | null): RoundCause {
  if (isRoundCause(reported)) return reported;
  if (pull && (pull.mergeable === 'CONFLICTING' || pull.mergeState === 'DIRTY')) return 'conflict';
  if (pull?.checks === 'failing') return 'checks';
  return 'bug';
}

/** A fix session's cause: why its PR went back (QA's cause for a QA fix); null without its QA record. */
export function fixCause(rec: { fixReason: 'qa' | 'checks' | 'conflict' | null; fixInstructions: string | null; qaCause?: RoundCause | null } | undefined): RoundCause | null {
  if (!rec) return null;
  if (rec.fixReason === 'conflict') return 'conflict';
  if (rec.fixReason === 'checks') return checksCause(rec.fixInstructions);
  return rec.qaCause ?? 'bug';
}

// ---------- the numbers ----------

const DAY = 24 * 60 * 60_000;

/** A QA session with a verdict: a round. */
const isRound = (s: CostSession) => s.kind === 'qa' && (s.outcome === 'qa-pass' || s.outcome === 'qa-fail');

/**
 * A failed round with its cause: a QA verdict of fail, or a checks or conflict fix (those send a PR back without QA
 * failing it). QA fixes aren't counted again: their round is. Lines from before causes were recorded have none.
 */
const failedCause = (s: CostSession): RoundCause | null => {
  if (!s.cause) return null;
  if (s.kind === 'qa') return s.outcome === 'qa-fail' ? s.cause : null;
  return s.kind === 'fix-checks' || s.kind === 'fix-conflict' ? s.cause : null;
};

interface RoundsPr {
  repoId: string;
  pr: number;
  issue: number | null;
  rounds: number; // its failed rounds of this cause
}

export interface RoundsCauseRow {
  cause: RoundCause;
  rounds: number;
  prs: RoundsPr[]; // the most first, at most 20
}

export interface RoundStats {
  merges: number; // merged PRs with a counted QA round
  rounds: number; // their QA rounds, outage and lab-error ones left out
  perMerge: number | null;
  firstPass: number | null; // share of first rounds that passed, 0..1
  excluded: number; // failed rounds of outage or lab-error
}

interface RoundsWindow extends RoundStats {
  byCause: RoundsCauseRow[]; // failed rounds by cause, the most first
}

interface RoundsFloor {
  repoId: string;
  week: RoundStats;
  month: RoundStats;
}

export interface RoundsView {
  week: RoundsWindow;
  month: RoundsWindow;
  floors: RoundsFloor[];
  /** The trailing week's rounds per merge and first-round pass rate, a point a day over 30 days, oldest first. */
  trend: { perMerge: (number | null)[]; firstPass: (number | null)[] };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rounds per merge and first-round pass rate over [since, until]: merges in it, QA rounds of those PRs from any time. */
export function roundStats(records: CostRecord[], since: number, until: number): RoundStats {
  const sessions = records.filter((r): r is CostSession => r.type === 'session');
  const merged = records.filter((r): r is CostMerge => r.type === 'merge' && r.at >= since && r.at <= until);
  const rounds = new Map<string, number>();
  for (const s of sessions) if (isRound(s) && s.pr !== null && !excludedCause(s.cause)) rounds.set(`${s.repoId}#${s.pr}`, (rounds.get(`${s.repoId}#${s.pr}`) ?? 0) + 1);
  const counts = merged.flatMap((m) => rounds.get(`${m.repoId}#${m.pr}`) ?? []);
  const inWindow = sessions.filter((s) => s.at >= since && s.at <= until);
  const firsts = inWindow.filter((s) => isRound(s) && s.round === 1 && !excludedCause(s.cause));
  const total = counts.reduce((a, b) => a + b, 0);
  return {
    merges: counts.length,
    rounds: total,
    perMerge: counts.length ? round2(total / counts.length) : null,
    firstPass: firsts.length ? round2(firsts.filter((s) => s.outcome === 'qa-pass').length / firsts.length) : null,
    excluded: inWindow.filter((s) => excludedCause(failedCause(s))).length,
  };
}

/** Failed rounds over [since, until] by cause, the most first, each with its PRs. */
export function roundsByCause(records: CostRecord[], since: number, until: number): RoundsCauseRow[] {
  const rows = new Map<RoundCause, Map<string, RoundsPr>>();
  for (const r of records) {
    if (r.type !== 'session' || r.at < since || r.at > until) continue;
    const cause = failedCause(r);
    if (!cause) continue;
    const prs = rows.get(cause) ?? new Map<string, RoundsPr>();
    rows.set(cause, prs);
    const key = `${r.repoId}#${r.pr ?? `i${r.issue}`}`;
    const p = prs.get(key) ?? { repoId: r.repoId, pr: r.pr ?? 0, issue: r.issue, rounds: 0 };
    p.rounds++;
    prs.set(key, p);
  }
  return [...rows]
    .map(([cause, prs]) => {
      const list = [...prs.values()].sort((a, b) => b.rounds - a.rounds || b.pr - a.pr);
      return { cause, rounds: list.reduce((n, p) => n + p.rounds, 0), prs: list.slice(0, 20) };
    })
    .sort((a, b) => b.rounds - a.rounds);
}

/** The Rounds card: the last 7 and 30 days (today counts as one), per floor and in total, and the trend. */
export function roundsView(records: CostRecord[], today: number, now: number): RoundsView {
  const week = today - 6 * DAY;
  const month = today - 29 * DAY;
  const window = (since: number): RoundsWindow => ({ ...roundStats(records, since, now), byCause: roundsByCause(records, since, now) });
  const repos = [...new Set(records.map((r) => r.repoId))].filter(Boolean).sort();
  const floors = repos.map((repoId) => {
    const mine = records.filter((r) => r.repoId === repoId);
    return { repoId, week: roundStats(mine, week, now), month: roundStats(mine, month, now) };
  });
  const points = Array.from({ length: 30 }, (_, i) => {
    const end = today - (29 - i) * DAY;
    return roundStats(records, end - 6 * DAY, Math.min(now, end + DAY - 1));
  });
  return { week: window(week), month: window(month), floors, trend: { perMerge: points.map((p) => p.perMerge), firstPass: points.map((p) => p.firstPass) } };
}

/** company_status's failed rounds by cause over 7 days, e.g. { bug: 3, nit: 1 }: small. */
export function causeCounts(rows: RoundsCauseRow[]): Partial<Record<RoundCause, number>> {
  return Object.fromEntries(rows.map((r) => [r.cause, r.rounds]));
}
