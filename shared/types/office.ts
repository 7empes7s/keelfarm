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
}

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
