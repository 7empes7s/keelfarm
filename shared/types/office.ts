// The office itself: Claude's usage, mission control, the doctor and the office's own update. Imported through shared/types.ts.

/** The last usage warning Claude gave: which limit ("weekly limit"), how full it was (0-100), when it resets, and when it came. */
export interface UsageWarningView {
  limit: string | null;
  pct: number | null;
  resetsAt: number | null;
  at: number;
}

/** Claude's subscription usage: normal, pacing new work after a usage warning, or paused at the limit until `until`. */
export interface UsageView {
  state: 'normal' | 'pacing' | 'paused';
  until: number | null;
  warning: UsageWarningView | null; // the latest since the office started, for the usage meter
  byChoice?: true; // full speed by the manager's choice (#323): "Keep full speed", or Resume full speed for this window
}

/** Settings → Agents, "When Claude warns that usage is high" (#323): pace new work, keep full speed until the limit, or pace and ask again after every restart. */
export type UsageWarningChoice = 'pace' | 'full' | 'ask';

/**
 * Claude's latest reading of one usage limit, from any session's status line or rate-limit event. These are the whole
 * subscription's numbers, so they include usage outside the office (claude.ai, other Claude Code sessions).
 */
export interface UsageReading {
  type: string; // Claude's rate limit type: five_hour, seven_day, seven_day_opus, …
  pct: number; // how full, 0-100
  resetsAt: number | null; // epoch ms
  at: number; // when it was read
}

/** A usage bar's hover (#334, shared/usageShares.ts): the floors' and the CEO's shares of the office's spend in that bar's window. */
export interface UsageShares {
  type: string; // the reading's limit type
  since: number; // when the window began
  usd: number; // the office's spend in it
  rows: { repoId: string; usd: number; pct: number }[]; // repoId '' is the CEO; whole percentages, with others' summing to 100
  others: { count: number; usd: number; pct: number } | null; // the rest past the fourth row
}

/** Why the office's own idle check of Claude's usage (#89) found nothing: no login on file, an expired one, or it failed. */
export type UsageCheckError = 'no-login' | 'expired' | 'failed';

// Mission control's numbers live in ../ops.ts.
export type { OpsAlarm, OpsFloor, OpsNumbers, OpsView } from '../ops.ts';

/** What the office doctor's one-click fixes do (#262): the console's own actions, nothing new. */
export type DoctorFix = 'clear' | 'stop' | 'requeue' | 'retry-qa' | 'send-back' | 'close-issue';

/** Something stuck the watchdog has no safe remedy for, or already remedied within the hour (server/watchdog.ts). */
export interface DoctorFinding {
  id: string; // stable while the problem lasts
  kind: 'quiet' | 'preparing' | 'stale' | 'qa-orphan' | 'fix-orphan' | 'unclosed';
  repoId: string;
  agentId: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  text: string;
  fixes: DoctorFix[];
  since: number;
}

/**
 * Where the office's own update stands. none: up to date · available: new commits on GitHub · waiting / draining:
 * starting nothing new while running sessions finish · updating: handed to the launcher · failed: see detail.
 */
export type OfficeUpdateState = 'none' | 'available' | 'waiting' | 'settling' | 'draining' | 'updating' | 'failed';

export interface OfficeUpdateView {
  state: OfficeUpdateState;
  behind: number; // commits the office's folder is behind GitHub
  launcher: boolean; // started by npm run dev / npm start, which can install the update and restart the office
  drainingSince: number | null;
  running: number; // sessions still running that an office restart would stop (CLIs in the terminal keeper or a Box carry on)
  updateAt: number | null; // settling: when the update goes ahead unless another commit lands
  holds: boolean; // nothing new starts until the office has restarted
  detail: string | null;
}

/** What the manager did on a board (#207): the kinds of action the CEO hears about. */
export type ManagerChangeKind = 'close-issue' | 'close-pr' | 'merge' | 're-qa' | 'send-back' | 'assign';

/** What the CEO did about a change that touched running work. */
export type CeoVerdict = 'stopped' | 'redirected' | 'let-finish';

/**
 * One of the manager's board actions (#207). The action happens at once; agents it touched keep working until the
 * CEO decides (shared/managerChanges.ts).
 */
export interface ManagerChange {
  id: string;
  at: number;
  kind: ManagerChangeKind;
  repoId: string;
  floor: number;
  issue: number | null;
  pr: number | null;
  detail: string; // one line, e.g. 'closed #12 "Dark mode"'
  affects: string[]; // ids of the agents whose running work it touched
  told: boolean; // in a CEO job's prompt already
  verdict: CeoVerdict | null; // what the CEO did about the agents it touched (null: undecided, or none touched)
}
