// Where the Claude plan goes (#18): the kinds of task a session can be, what came of it, the cost ledger's view, and
// which reasoning effort a session runs at. Pure, shared by the server (the ledger) and the client (the usage view).
import type { ConflictStats } from './conflicts.ts';
import type { RoundCause, RoundsView } from './rounds.ts';
import type { StartupContext, StartupRow } from './startup.ts';
import type { EffortLevel } from './types.ts';

/** What a session was for. Fixes are split by why the PR went back; the CEO's by its job. */
export type TaskKind = 'issue' | 'qa' | 'fix-qa' | 'fix-checks' | 'fix-conflict' | 'ceo-chat' | 'ceo-review' | 'ceo-plan' | 'ceo-onboard' | 'ceo-triage' | 'ceo-followup' | 'ceo-research' | 'ceo-changes' | 'ceo-wait' | 'consult';

export const TASK_KINDS: TaskKind[] = ['issue', 'qa', 'fix-qa', 'fix-checks', 'fix-conflict', 'ceo-chat', 'ceo-review', 'ceo-plan', 'ceo-onboard', 'ceo-triage', 'ceo-followup', 'ceo-research', 'ceo-changes', 'ceo-wait', 'consult'];

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  issue: 'Building an issue',
  qa: 'QA',
  'fix-qa': "Fixing QA's findings",
  'fix-checks': 'Fixing a red check',
  'fix-conflict': 'Fixing a merge conflict',
  'ceo-chat': 'CEO chat',
  'ceo-review': 'CEO review',
  'ceo-plan': 'CEO planning',
  'ceo-onboard': 'CEO onboarding',
  'ceo-triage': 'CEO triage',
  'ceo-followup': 'CEO follow-up',
  'ceo-research': 'CEO research',
  'ceo-changes': 'CEO on your changes',
  'ceo-wait': 'CEO job that waited',
  consult: 'Consult for the CEO',
};

export const isTaskKind = (x: unknown): x is TaskKind => TASK_KINDS.includes(x as TaskKind);
export const isCeoKind = (k: TaskKind) => k.startsWith('ceo-');

/** What came of a session. */
export type SessionOutcome =
  | 'pr' // an issue session that opened (or has) a PR
  | 'no-pr' // an issue session that ended without one
  | 'commit' // a fix that pushed
  | 'no-commit' // a fix that pushed nothing
  | 'no-change' // a fix that said nothing needs to change (QA re-tests it)
  | 'qa-pass'
  | 'qa-fail'
  | 'ceo-acted' // a CEO job that filed issues or changed something
  | 'ceo-idle' // a CEO job that changed nothing
  | 'done' // finished, nothing more to say (e.g. a QA session resumed to finish its report)
  | 'interrupted' // Esc in the terminal
  | 'stopped' // the manager stopped it, or its issue or PR closed
  | 'watchdog' // the watchdog stopped it after it went quiet
  | 'limited' // cut off by Claude's usage limit
  | 'error';

/** Session outcomes the usage view lists as waste on their own. */
const WASTED: Partial<Record<SessionOutcome, string>> = {
  'no-pr': 'ended without a PR',
  'no-commit': 'ended without a commit',
  watchdog: 'stopped by the watchdog',
  limited: "cut off by Claude's usage limit",
};

/** A finished session, one line of the cost ledger. */
export interface CostSession {
  type: 'session';
  at: number; // when it ended
  ms: number; // how long it ran
  repoId: string; // '' for the CEO's company-wide jobs
  agentId: string;
  agent: string;
  kind: TaskKind;
  issue: number | null;
  pr: number | null;
  round: number | null; // QA: the PR's QA round
  cause?: RoundCause; // a failed QA round's or a fix's cause (#188, shared/rounds.ts)
  model: string;
  effort: EffortLevel | '';
  usd: number;
  tokens: number | null; // when the CLI reports them
  outcome: SessionOutcome;
  exp?: string; // `${experiment}/${variant}` while its issue is in a running experiment (shared/experiments.ts)
  cheap?: boolean; // a conflict-only fix that ran on Settings' cheaper model (#256, shared/conflicts.ts)
  startup?: StartupContext; // what its first turn loaded (shared/startup.ts), when the CLI reported it
  account?: string; // the account it ran on (#247, shared/accounts.ts)
}

/** A merged PR, one line of the cost ledger: what the sessions' cost is divided by. */
export interface CostMerge {
  type: 'merge';
  at: number;
  repoId: string;
  pr: number;
  issues: number[]; // the issues it closes
}

export type CostRecord = CostSession | CostMerge;

/** Why a session counts as waste, or null. QA rounds past the 2nd, and CEO reviews that changed nothing, count too. */
export function wasteReason(s: Pick<CostSession, 'kind' | 'outcome' | 'round'>): string | null {
  const why = WASTED[s.outcome];
  if (why) return why;
  if (s.kind === 'qa' && s.round !== null && s.round > 2) return `QA round ${s.round}`;
  if (s.kind === 'ceo-review' && s.outcome === 'ceo-idle') return 'a review that changed nothing';
  return null;
}

/** What came of a finished session: how it ended first, else what its task's handler saw (hint), else ok or not. */
export function sessionOutcome(x: { interrupted: boolean; watchdog: boolean; stopped: boolean; limited: boolean; ok: boolean; hint: SessionOutcome | null }): SessionOutcome {
  if (x.interrupted) return 'interrupted';
  if (x.watchdog) return 'watchdog';
  if (x.stopped) return 'stopped';
  if (x.hint) return x.hint;
  if (!x.ok) return x.limited ? 'limited' : 'error';
  return 'done';
}

/**
 * The effort a session runs at: the agent's own setting, else the manager's default for this kind of task, else the
 * office's default (the CEO's own for the CEO). Defaults per kind are empty unless the manager sets them.
 */
export function resolveEffort(agent: EffortLevel | '', kind: TaskKind, byKind: Partial<Record<TaskKind, EffortLevel>>, office: EffortLevel): EffortLevel {
  return agent || byKind[kind] || office;
}

// ---------- the usage view (GET /api/costs) ----------

export interface CostSplit {
  usd: number;
  sessions: number;
  merges: number;
  perMerge: number | null; // usd / merges; null without a merge
  wasteUsd: number;
  wasteSessions: number;
  byKind: Partial<Record<TaskKind, number>>; // dollars
}

export interface CostFloorRow extends CostSplit {
  repoId: string; // '' for the CEO's company-wide jobs
}

export interface CostDayRow extends CostSplit {
  day: string; // YYYY-MM-DD, local time
}

/** The most expensive pieces of work: an issue with its PR's QA and fixes, or a PR on its own. */
export interface CostItem {
  repoId: string;
  issue: number | null;
  pr: number | null;
  usd: number;
  sessions: number;
  qaRounds: number; // its QA sessions
  merged: boolean;
}

export interface CostWaste {
  at: number;
  repoId: string;
  agent: string;
  kind: TaskKind;
  issue: number | null;
  pr: number | null;
  usd: number;
  why: string;
  cause: string; // wasteCause: what the waste list groups by
  streak: number; // wasted the same way this many sessions in a row on its piece of work, this one included
}

/** What a kind of task averaged, overall and at each effort it ran at: the expected effect of a default per kind. */
export interface CostKindRow {
  kind: TaskKind;
  sessions: number;
  avg: number;
  byEffort: { effort: EffortLevel | ''; sessions: number; avg: number }[];
}

export interface CostsView {
  days: number;
  since: number;
  total: CostSplit;
  floors: CostFloorRow[];
  byDay: CostDayRow[]; // newest first
  top: CostItem[];
  waste: CostWaste[]; // newest first
  kinds: CostKindRow[];
  startup: StartupRow[]; // what each kind of task loads before its first step (#50)
  rounds: RoundsView; // QA rounds per merge and by cause over 7 and 30 days, whatever `days` is (#188)
  conflicts?: ConflictStats; // conflict rounds per merge and what cheap conflict fixes saved, over 7 days (#256)
}

/** Settings → effort per kind: what the ledger says this kind cost, e.g. "QA averaged $0.84 at medium (23), $0.40 at low (5)". */
export function effortHint(kind: TaskKind, row: CostKindRow | undefined, fallback: EffortLevel): string | null {
  if (!row?.sessions) return null;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const parts = [...row.byEffort].sort((a, b) => b.sessions - a.sessions).map((e) => `${usd(e.avg)} at ${e.effort || fallback} (${e.sessions})`);
  return `${TASK_KIND_LABELS[kind]} averaged ${parts.join(', ')} over the last 30 days.`;
}

// ---------- the usage view's cards and insights (#106) ----------

/** Task kinds in four: the share bar's build / QA / fix / CEO (a consult is for the CEO). */
export type KindGroup = 'build' | 'qa' | 'fix' | 'ceo';
const KIND_GROUPS: KindGroup[] = ['build', 'qa', 'fix', 'ceo'];
export const KIND_GROUP_LABELS: Record<KindGroup, string> = { build: 'Build', qa: 'QA', fix: 'Fix', ceo: 'CEO' };
export const kindGroup = (k: TaskKind): KindGroup => (k === 'issue' ? 'build' : k === 'qa' ? 'qa' : k.startsWith('fix-') ? 'fix' : 'ceo');

const cents = (n: number) => Math.round(n * 100) / 100;

/** What the waste list groups a wasted session under, e.g. "Build ended without a PR" (`why` is wasteReason's). */
export function wasteCause(kind: TaskKind, why: string): string {
  if (kind === 'qa' && why.startsWith('QA round')) return 'QA past round 2';
  if (kind === 'ceo-review' && why === 'a review that changed nothing') return 'CEO review that changed nothing';
  return `${KIND_GROUP_LABELS[kindGroup(kind)]} ${why}`;
}

/** A wasted session's piece of work: its issue, else its PR, else (the CEO's jobs) its floor and kind. */
const wasteWork = (w: Pick<CostWaste, 'repoId' | 'issue' | 'pr' | 'kind'>) => (w.issue !== null ? `${w.repoId}#${w.issue}` : w.pr !== null ? `${w.repoId}!${w.pr}` : `${w.repoId}:${w.kind}`);

/** Wasted sessions of one piece of work in a row (newest first), shown as one card with an "N× in a row" badge. */
interface WasteRun {
  items: CostWaste[];
  usd: number;
}

export interface WasteGroup {
  cause: string;
  usd: number;
  count: number;
  share: number; // of the listed waste, 0..1
  runs: WasteRun[]; // newest first
}

/** The waste list (newest first) by cause, the costliest cause first; a cause's sessions in a row on one piece of work as one run. */
export function wasteGroups(waste: CostWaste[]): WasteGroup[] {
  const total = waste.reduce((n, w) => n + w.usd, 0);
  const groups = new Map<string, WasteGroup>();
  const open = new Map<string, WasteRun>(); // cause + piece of work → its newest run so far
  for (const w of waste) {
    let g = groups.get(w.cause);
    if (!g) groups.set(w.cause, (g = { cause: w.cause, usd: 0, count: 0, share: 0, runs: [] }));
    g.usd += w.usd;
    g.count++;
    const key = `${w.cause}|${wasteWork(w)}`;
    const run = open.get(key);
    if (run && run.items[run.items.length - 1].streak === w.streak + 1) {
      run.items.push(w);
      run.usd += w.usd;
    } else {
      const fresh = { items: [w], usd: w.usd };
      g.runs.push(fresh);
      open.set(key, fresh);
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, usd: cents(g.usd), share: total ? g.usd / total : 0, runs: g.runs.map((r) => ({ ...r, usd: cents(r.usd) })) }))
    .sort((a, b) => b.usd - a.usd);
}

/** The local day `n` days before `day` (both YYYY-MM-DD). */
function dayBefore(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(y, m - 1, d - n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** Today's spend against the daily average of the (up to 7) days before it in the view; null in a one-day view. */
export function spendVsAverage(view: Pick<CostsView, 'byDay' | 'days'>, today: string): { usd: number; avg: number; change: number | null } | null {
  const n = Math.min(7, view.days - 1);
  if (n < 1) return null;
  const usdOn = (day: string) => view.byDay.find((d) => d.day === day)?.usd ?? 0;
  const avg = cents(Array.from({ length: n }, (_, i) => usdOn(dayBefore(today, i + 1))).reduce((a, b) => a + b, 0) / n);
  const usd = usdOn(today);
  return { usd, avg, change: avg ? (usd - avg) / avg : null };
}

/** Cost per merge day by day (oldest first, null on a day without a merge), and how the newer half moved against the older. */
export function perMergeTrend(byDay: CostDayRow[]): { points: (number | null)[]; change: number | null } {
  const points = [...byDay].reverse().map((d) => d.perMerge);
  const vals = points.filter((p): p is number => p !== null);
  if (vals.length < 2) return { points, change: null };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const half = Math.floor(vals.length / 2);
  const older = mean(vals.slice(0, half));
  return { points, change: older ? (mean(vals.slice(half)) - older) / older : null };
}

/** Each kind group's dollars and share of the spend, build / QA / fix / CEO, the empty ones left out. */
export function kindShares(byKind: CostSplit['byKind']): { group: KindGroup; usd: number; share: number }[] {
  const usd: Record<KindGroup, number> = { build: 0, qa: 0, fix: 0, ceo: 0 };
  for (const [k, n] of Object.entries(byKind) as [TaskKind, number][]) usd[kindGroup(k)] += n;
  const total = KIND_GROUPS.reduce((n, g) => n + usd[g], 0);
  return KIND_GROUPS.filter((g) => usd[g] > 0).map((g) => ({ group: g, usd: cents(usd[g]), share: usd[g] / total }));
}

/** The costliest floor (the CEO's company-wide jobs aren't a floor) and its share of the spend. */
export function topFloor(view: Pick<CostsView, 'floors' | 'total'>): { repoId: string; usd: number; share: number } | null {
  const best = view.floors.filter((f) => f.repoId).sort((a, b) => b.usd - a.usd)[0];
  return best && view.total.usd ? { repoId: best.repoId, usd: best.usd, share: best.usd / view.total.usd } : null;
}

export interface CostInsights {
  today: ReturnType<typeof spendVsAverage>;
  perMerge: ReturnType<typeof perMergeTrend>;
  wasteShare: number | null; // of all spend, 0..1
  biggestCause: { cause: string; usd: number } | null;
  topFloor: ReturnType<typeof topFloor>;
  kinds: ReturnType<typeof kindShares>;
}

/** The insight strip over the costs: `today` is the local YYYY-MM-DD. */
export function costInsights(view: CostsView, today: string): CostInsights {
  const [cause] = wasteGroups(view.waste);
  return {
    today: spendVsAverage(view, today),
    perMerge: perMergeTrend(view.byDay),
    wasteShare: view.total.usd ? view.total.wasteUsd / view.total.usd : null,
    biggestCause: cause ? { cause: cause.cause, usd: cause.usd } : null,
    topFloor: topFloor(view),
    kinds: kindShares(view.total.byKind),
  };
}
