import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME_DIR } from './config.ts';
import { git } from './exec.ts';
import type { OfficeUpdateState } from '../shared/types.ts';

// The office updating itself (#37, #74). The server only decides when: it lets a run of merges settle into one update,
// drains the sessions an office restart would stop (CLIs in the terminal keeper and in Boxes carry on through it), and
// hands the update to the launcher (scripts/office.mjs), which runs the preflight while work goes on, then switches,
// installs, builds and restarts it. Contract with the launcher:
//   server → launcher  { type: 'office:update', from: '<full HEAD sha>' }   once drained
//   launcher → server  { type: 'office:shutdown', restart }                  run shutdown(), then exit 0
//                      (restart: false when the office quits; agents' CLIs stop instead of waiting in the keeper)
//   launcher → server  { type: 'office:update-result' }                     it kept this office running (the preflight
//                      refused the update, or there was nothing to do): read last-update.json now
//   <SWARM_HOME>/last-update.json = { from, to, target?, ok, stage?, error?, installed, built, at }, read and deleted
//   on startup or on office:update-result

/** Sessions still running this long after draining started are stopped, and the update goes ahead. */
export const DRAIN_TIMEOUT_MS = 20 * 60_000;
/** Later: ask again after this long, or sooner when a newer commit lands. */
export const POSTPONE_MS = 2 * 60 * 60_000;
/** Batching: an automatic update waits until no commit has landed for this many minutes (Settings)… */
const DEFAULT_SETTLE_MIN = 3;
/** …but no longer than this after the first commit it would bring in. */
export const SETTLE_MAX_MS = 15 * 60_000;

/** The settle window's minutes from a setting: 0 (no wait) to 60, else the default. */
export function settleMinutes(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v !== null && v !== '' ? Math.max(0, Math.min(60, n)) : DEFAULT_SETTLE_MIN;
}

/**
 * When a run of commits has settled: settleMs after the latest one, at most SETTLE_MAX_MS (or settleMs, if longer)
 * after the first. null: no commit is being waited for.
 */
export function settleAt(pendingSince: number | null, lastCommitAt: number | null, settleMs: number): number | null {
  if (pendingSince === null) return null;
  return Math.min((lastCommitAt ?? pendingSince) + settleMs, pendingSince + Math.max(settleMs, SETTLE_MAX_MS));
}

/** Started by the launcher: an IPC channel and SWARM_LAUNCHER=1. Anything else (tsx, the demo, QA) only reports. */
export function underLauncher(proc: { send?: unknown; env: Record<string, string | undefined> } = process): boolean {
  return typeof proc.send === 'function' && proc.env.SWARM_LAUNCHER === '1';
}

export interface DrainInput {
  now: number;
  behind: number; // commits the office's folder can fast-forward by (0: nothing to update)
  launcher: boolean;
  autoUpdate: boolean;
  requested: boolean; // the manager pressed Update now
  postponedUntil: number | null; // the manager pressed Later
  postponedBehind: number; // how far behind it was then: a newer commit ends the postponement
  failed: string | null; // the last update's error
  failedBehind: number | null; // how far behind it was after that failure: only a newer commit retries on its own
  drainingSince: number | null;
  sent: boolean; // handed to the launcher
  running: number; // sessions an office restart would stop (not CLIs in the terminal keeper or in a Box)
  pendingSince: number | null; // the first commit of this update was seen then (null: don't wait for more)
  lastCommitAt: number | null; // the latest one
  settleMs: number;
  keeper: boolean; // new sessions start in the terminal keeper, so work may go on while the launcher runs the preflight
}

export interface DrainDecision {
  state: OfficeUpdateState;
  drainingSince: number | null;
  /** Hand the update to the launcher now: nothing is running, or the drain timed out (`timedOut`). */
  send: boolean;
  timedOut: boolean;
  /** Nothing new starts: while draining, and while the launcher has it if new sessions wouldn't outlive the restart. */
  holds: boolean;
  /** Settling: when the update goes ahead unless another commit lands. */
  updateAt: number | null;
}

/**
 * Where the office's own update stands and what to do about it. An update is due when there is one, a launcher, and
 * either autoUpdate is on or the manager pressed Update now. An automatic one first settles (more commits may come),
 * then drains: nothing new starts while the sessions a restart would stop finish (up to DRAIN_TIMEOUT_MS). With none
 * of those, it goes to the launcher at once. Later holds an automatic update back for POSTPONE_MS or until a newer
 * commit lands ('waiting'); a failed update is only retried automatically for a newer commit.
 */
export function drainDecision(s: DrainInput): DrainDecision {
  const idle = (state: OfficeUpdateState, updateAt: number | null = null): DrainDecision => ({ state, drainingSince: null, send: false, timedOut: false, holds: false, updateAt });
  if (s.sent) return { state: 'updating', drainingSince: s.drainingSince, send: false, timedOut: false, holds: !s.keeper, updateAt: null };
  if (s.behind <= 0) return idle('none');
  if (!s.launcher) return idle(s.failed ? 'failed' : 'available');
  const postponed = s.postponedUntil !== null && s.now < s.postponedUntil && s.behind <= s.postponedBehind;
  const failedHold = s.failed !== null && s.behind <= (s.failedBehind ?? Infinity);
  const due = s.requested || (s.autoUpdate && !postponed && !failedHold);
  if (!due) return idle(s.failed ? 'failed' : s.autoUpdate && postponed ? 'waiting' : 'available');
  const at = s.requested || s.drainingSince !== null ? null : settleAt(s.pendingSince, s.lastCommitAt, s.settleMs);
  if (at !== null && s.now < at) return idle('settling', at);
  const since = s.drainingSince ?? s.now;
  const timedOut = s.running > 0 && s.now - since >= DRAIN_TIMEOUT_MS;
  return { state: 'draining', drainingSince: since, send: s.running === 0 || timedOut, timedOut, holds: true, updateAt: null };
}

/** Where an update failed: before the live office was touched, while switching it, or in the probation after its restart. */
export type UpdateStage = 'check' | 'preflight' | 'switch' | 'probation';
const STAGES: UpdateStage[] = ['check', 'preflight', 'switch', 'probation'];

/** What the launcher leaves behind after an update. */
export interface LastUpdate {
  from: string;
  /** The commit the office runs afterwards. */
  to: string;
  /** The commit it tried to update to. */
  target?: string;
  ok: boolean;
  stage?: UpdateStage;
  error?: string;
  installed: boolean;
  built: boolean;
  at: number;
}

/** Parse last-update.json; null when it isn't one. */
export function parseLastUpdate(raw: string): LastUpdate | null {
  try {
    const u = JSON.parse(raw) as Partial<LastUpdate>;
    if (!u || typeof u.from !== 'string' || typeof u.ok !== 'boolean') return null;
    return {
      from: u.from,
      to: typeof u.to === 'string' ? u.to : '',
      target: typeof u.target === 'string' ? u.target : undefined,
      ok: u.ok,
      stage: STAGES.includes(u.stage as UpdateStage) ? u.stage : undefined,
      error: typeof u.error === 'string' ? u.error : undefined,
      installed: !!u.installed,
      built: !!u.built,
      at: Number(u.at) || Date.now(),
    };
  } catch {
    return null;
  }
}

/** Read and delete <home>/last-update.json, so its phone message is posted once. */
export async function takeLastUpdate(home: string): Promise<LastUpdate | null> {
  const file = path.join(home, 'last-update.json');
  const raw = await fs.readFile(file, 'utf8').catch(() => null);
  if (raw === null) return null;
  await fs.rm(file, { force: true, maxRetries: 3 }).catch(() => undefined);
  return parseLastUpdate(raw);
}

/** The phone message for an update: "Updated the office from abc1234 to def5678 (3 commits)" or why it failed. */
export function lastUpdateMessage(u: LastUpdate, commits: number | null): string {
  const [from, to, target] = [u.from, u.to || u.from, u.target || ''].map((sha) => sha.slice(0, 7));
  const error = u.error || 'unknown error';
  if (!u.ok && u.stage === 'check') return `⚠️ Update refused: ${error}; still on ${from}`;
  if (!u.ok && u.stage === 'preflight') return `⚠️ Update${target ? ` to ${target}` : ''} refused: ${error} in the preflight; still on ${from}`;
  if (!u.ok && u.stage === 'probation') return `⚠️ Update${target ? ` to ${target}` : ''} rolled back: ${error}; back on ${to}`;
  if (!u.ok) return `⚠️ Update failed and was rolled back: ${error}`;
  if (u.from === u.to) return `The office is already up to date at ${from}`;
  const n = commits === null ? '' : ` (${commits} commit${commits === 1 ? '' : 's'})`;
  return `⬆️ Updated the office from ${u.from.slice(0, 7)} to ${u.to.slice(0, 7)}${n}`;
}

// ---------- the running office ----------

/** The running office's own checkout and its launcher. The demo fakes it. */
export interface OfficeHost {
  launcher: boolean;
  /** Full sha of the commit the office runs, or null when it doesn't run from a git checkout (e.g. installed from npm). */
  head(): Promise<string | null>;
  /** Is this floor checkout the office's own folder? Syncing it would restart the office mid-work, so it's only reported. */
  isOwnFolder(dir: string): boolean;
  /** Commits between two shas of the office's folder, or null when git can't tell. */
  commitsBetween(from: string, to: string): Promise<number | null>;
  /** Read and delete the result the launcher left from the last update. */
  takeLastUpdate(): Promise<LastUpdate | null>;
  /**
   * Hand the drained office to the launcher. It restarts the office (never resolves), or keeps it running when the
   * preflight refuses the update and resolves with that result. The demo resolves with a fake result.
   */
  update(from: string): Promise<LastUpdate | null>;
}

const OFFICE_DIR = path.resolve(import.meta.dirname, '..');
const isSamePath = (a: string, b: string) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

export const realOffice: OfficeHost = {
  launcher: underLauncher(),
  head: () => git(['rev-parse', 'HEAD'], { cwd: OFFICE_DIR }).catch(() => null),
  isOwnFolder: (dir) => isSamePath(dir, OFFICE_DIR),
  commitsBetween: (from, to) =>
    git(['rev-list', '--count', `${from}..${to}`], { cwd: OFFICE_DIR })
      .then(Number)
      .catch(() => null),
  takeLastUpdate: () => takeLastUpdate(HOME_DIR),
  async update(from) {
    if (!underLauncher()) throw new Error('The office was not started by the launcher');
    const kept = new Promise<void>((resolve) => {
      const onMessage = (msg: unknown) => {
        if ((msg as { type?: unknown } | null)?.type !== 'office:update-result') return;
        process.off('message', onMessage);
        resolve();
      };
      process.on('message', onMessage);
    });
    await new Promise<void>((resolve, reject) => process.send!({ type: 'office:update', from }, undefined, {}, (err) => (err ? reject(err) : resolve())));
    await kept;
    return (await takeLastUpdate(HOME_DIR)) ?? { from, to: from, ok: false, error: 'the launcher kept the office running without saying why', installed: false, built: false, at: Date.now() };
  },
};
