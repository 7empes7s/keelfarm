import type { PullInfo } from '../shared/types.ts';
import { QA_STOPPED } from './prOwnership.ts';

// No PR sits in "needs you" for hours (#275). A needs-human PR older than the re-check time is looked at again: once
// QA passed it and all that holds it is a conflict with the base or a check GitHub never ran (or that is green or
// running now), it goes back into the flow by itself. Anything else gets the CEO's triage again, at most every
// RETRIAGE_MS, so it is never forgotten. The manager's own stop and a desk that can't be set up stay with the manager.

export const DEFAULT_STUCK_RECHECK_MIN = 30;
export const RETRIAGE_MS = 2 * 60 * 60_000;

/** Settings → the re-check time in minutes, 5 to a day. */
export function clampStuckRecheckMin(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(1440, Math.max(5, n)) : DEFAULT_STUCK_RECHECK_MIN;
}

export interface StuckRecord {
  status: string;
  passedSha: string | null;
  summary: string | null;
  stuckWhy: string | null;
  stuckAt?: number | null;
  recheckAt?: number | null; // the CEO's last triage from a re-check
}

export type StuckPull = Pick<PullInfo, 'state' | 'headRefName' | 'mergeable' | 'mergeState' | 'checks' | 'failedChecks'>;

/**
 * conflict: a developer brings it up to date · merge-gate: back to auto-merge (it re-runs, parks or merges) · retriage:
 * the CEO looks again · wait: nothing yet. minAge: how long it must have waited (0: the one-off release on upgrade).
 */
export type StuckStep = 'conflict' | 'merge-gate' | 'retriage' | 'wait';

export function stuckRecheck(rec: StuckRecord, pr: StuckPull | undefined, now: number, minAge: number): StuckStep {
  if (rec.status !== 'needs-human' || rec.summary === QA_STOPPED || !pr || pr.state !== 'OPEN') return 'wait';
  const since = rec.stuckAt ?? now;
  if (now - since < minAge) return 'wait';
  if (rec.passedSha && pr.headRefName.startsWith('swarm/') && !/desk couldn't be set up/.test(rec.stuckWhy ?? '')) {
    if (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY') return 'conflict';
    const outage = pr.checks === 'failing' && pr.failedChecks.length > 0 && pr.failedChecks.every((c) => c.neverStarted);
    if (pr.checks !== 'failing' || outage) return 'merge-gate';
  }
  return now - Math.max(rec.recheckAt ?? 0, since) >= RETRIAGE_MS ? 'retriage' : 'wait';
}
