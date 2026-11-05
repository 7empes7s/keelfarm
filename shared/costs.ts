// Where the Claude plan goes (#18): the kinds of task a session can be, what came of it, the cost ledger's view, and
// which reasoning effort a session runs at. Pure, shared by the server (the ledger) and the client (the usage view).
import type { EffortLevel } from './types.ts';

/** What a session was for. Fixes are split by why the PR went back; the CEO's by its job. */
export type TaskKind = 'issue' | 'qa' | 'fix-qa' | 'fix-checks' | 'fix-conflict' | 'ceo-chat' | 'ceo-review' | 'ceo-plan' | 'ceo-onboard' | 'ceo-triage' | 'ceo-followup' | 'ceo-research' | 'ceo-wait' | 'consult';

export const TASK_KINDS: TaskKind[] = ['issue', 'qa', 'fix-qa', 'fix-checks', 'fix-conflict', 'ceo-chat', 'ceo-review', 'ceo-plan', 'ceo-onboard', 'ceo-triage', 'ceo-followup', 'ceo-research', 'ceo-wait', 'consult'];

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
  model: string;
  effort: EffortLevel | '';
  usd: number;
  tokens: number | null; // when the CLI reports them
  outcome: SessionOutcome;
  exp?: string; // `${experiment}/${variant}` while its issue is in a running experiment (shared/experiments.ts)
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
}

/** Settings → effort per kind: what the ledger says this kind cost, e.g. "QA averaged $0.84 at medium (23), $0.40 at low (5)". */
export function effortHint(kind: TaskKind, row: CostKindRow | undefined, fallback: EffortLevel): string | null {
  if (!row?.sessions) return null;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const parts = [...row.byEffort].sort((a, b) => b.sessions - a.sessions).map((e) => `${usd(e.avg)} at ${e.effort || fallback} (${e.sessions})`);
  return `${TASK_KIND_LABELS[kind]} averaged ${parts.join(', ')} over the last 30 days.`;
}
