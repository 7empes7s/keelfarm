// Runbook jobs (#611): a floor's install runbook (markdown with fenced steps) run by IT as one job, with one summary
// card, progress per step, a health check last and an Undo for the whole job. What both sides share: the job as the
// state file keeps it and as a tab sees it. The parsing, policy and runner are the server's (server/itRunbook.ts).

/** One step of a runbook: a command, an env file written with generated or Providers secrets, or a marked Caddy block. */
export type RunbookStep =
  | { kind: 'run'; argv: string[]; cwd?: string; check?: true }
  | { kind: 'env'; file: string; from?: string; vars: RunbookVar[] }
  | { kind: 'caddy'; site: string; body: string };

/** An env file's line: a literal, a secret generated on the machine (bytes of randomness, as hex), or a Providers key by reference. */
export interface RunbookVar {
  name: string;
  value: { literal: string } | { generate: number } | { provider: string };
}

/** What the job changed, for its Undo: a file it replaced (kept at `backup`) or created, a folder it made, a command that reverses one. */
type RunbookChange = { kind: 'file'; path: string; backup?: string } | { kind: 'dir'; path: string } | { kind: 'cmd'; argv: string[] };

export type RunbookStepState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';
type RunbookJobState = 'waiting' | 'running' | 'done' | 'failed' | 'dismissed' | 'undone';

export interface RunbookStepView {
  label: string; // the command, "write /opt/x/.env: JWT_SECRET, …" or "Caddy block for host"
  check?: true; // the runbook's own health check
  state: RunbookStepState;
  code?: number | null;
  out?: string; // short, masked: secrets only ever as "VAR (set, ends …ab12)"
}

/** A runbook job as a tab sees it. */
export interface ItRunbookView {
  id: string;
  title: string; // "Install Postiz"
  project: string; // its scope: /opt/<project>, /etc/<project>, <project>*.service
  source: string; // "floor 4: ops/postiz/RUNBOOK.md"
  by: string;
  at: number;
  summary: string; // "14 steps, touches /opt/postiz, a systemd unit postiz, the Caddy block for postiz.example.com"
  auto: boolean; // inside the auto-approve policy: ran with no tap
  held?: string; // why it needs the manager's Approve (the first step outside the policy)
  state: RunbookJobState;
  steps: RunbookStepView[];
  check?: { ok: boolean; out: string }; // the health check's verdict, when it ran
  undoable: boolean;
  ended?: number;
}

/** What the state file keeps: the view, the steps to run and what the job changed. */
export interface ItRunbookJob extends ItRunbookView {
  plan: RunbookStep[];
  changes: RunbookChange[];
}

export const RUNBOOKS_KEPT = 10;

/** A tab's view of a job: never its plan or its backups' paths. */
export function runbookView(j: ItRunbookJob): ItRunbookView {
  const { plan: _plan, changes: _changes, ...view } = j;
  return view;
}

/** The state file's runbook jobs, well-formed ones only; one cut off by a restart ends as failed. */
export function loadRunbooks(v: unknown): ItRunbookJob[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((j): j is ItRunbookJob => !!j && typeof j === 'object' && typeof j.id === 'string' && Array.isArray(j.plan) && Array.isArray(j.steps) && Array.isArray(j.changes))
    .slice(0, RUNBOOKS_KEPT)
    .map((j) => (j.state === 'running' ? { ...j, state: 'failed', steps: j.steps.map((s) => (s.state === 'running' ? { ...s, state: 'failed', out: 'Stopped by an office restart.' } : s)) } : j));
}
