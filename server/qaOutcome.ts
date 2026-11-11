import type { PullInfo } from '../shared/types.ts';
import { MAX_MERGE_FIXES } from './mergeGate.ts';

// What a finished QA round does to its PR. A conflict with the default branch is the merge gate's job, not QA's: a
// fail on the last QA round while the PR conflicts goes back for a merge fix (and one more QA round) rather than to
// the manager, as long as the merge-fix budget lasts. A PR that already conflicts never reaches a tester (qaGate).

/** QA rounds that fail before a PR goes to the manager. */
export const MAX_QA_ROUNDS = 6;

/** The parts of a QA record a finished QA round reads. */
export interface QaRoundRecord {
  round: number;
  retests: number; // rounds the office added (re-tests after merge fixes), not counted against QA's budget
  mergeFixes: number;
}

export type QaPull = Pick<PullInfo, 'mergeable' | 'mergeState'>;

/**
 * passed: on to the merge gate (which handles a conflict as it always has). failed: back to the developer.
 * conflict: back to the developer to merge the default branch and fix QA's findings. needs-human: the manager decides.
 */
export type QaNext = 'passed' | 'failed' | 'conflict' | 'needs-human';

/** True when a fail now would use up QA's rounds: only then is the PR's mergeability worth asking about. */
export function lastQaRound(rec: QaRoundRecord): boolean {
  return rec.round - rec.retests >= MAX_QA_ROUNDS;
}

/**
 * A retry of QA that the manager or the CEO asked for (#403). At the round cap the last report goes, so the next round
 * is a full fresh test with a new session and a new report, not a re-test of the old findings; below it nothing changes.
 */
export function freshRetry(rec: QaRoundRecord): { summary: null; checks: []; commentUrl: null; fixInstructions: null; testedSha: null; fixReason: null; shots: [] } | Record<string, never> {
  return lastQaRound(rec) ? { summary: null, checks: [], commentUrl: null, fixInstructions: null, testedSha: null, fixReason: null, shots: [] } : {};
}

/** Decide where a PR goes after QA. pr: its mergeability right now, or null when it wasn't (or couldn't be) asked. */
export function qaOutcome(pass: boolean, rec: QaRoundRecord, pr: QaPull | null): QaNext {
  if (pass) return 'passed';
  if (!lastQaRound(rec)) return 'failed';
  const conflicting = pr != null && (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY');
  return conflicting && rec.mergeFixes < MAX_MERGE_FIXES ? 'conflict' : 'needs-human';
}

/** A finished QA round's decision and budget: a failed test that also conflicts spends a merge fix, unlike maintenance before QA. */
export function qaRoundResult(pass: boolean, rec: QaRoundRecord, pr: QaPull | null): { next: QaNext; mergeFixes: number } {
  const next = qaOutcome(pass, rec, pr);
  return { next, mergeFixes: rec.mergeFixes + (next === 'conflict' ? 1 : 0) };
}

/**
 * After a lab-error report (#189): the lab failed, not the code, so the PR goes back to QA by itself once in a round
 * (retry) and to triage on a second one (stuck). Never a failed round, never to a developer.
 */
export function labErrorNext(rec: { round: number; labRetryRound: number | null }): 'retry' | 'stuck' {
  return rec.labRetryRound === rec.round ? 'stuck' : 'retry';
}

/**
 * A QA round that lost its lab to an office restart (#333): its session lived through the restart in the terminal
 * keeper and ended with no report, a lab-error verdict or a fail QA put down to the lab. It goes back to QA by itself
 * once a round (retry): no failed round, no lab error counted, never needs-human. Anything else: null, as before.
 */
export function restartLossNext(x: { acrossRestart: boolean; stopped: boolean; verdict: 'pass' | 'fail' | 'lab-error' | null; cause?: string | null; round: number; restartRetryRound: number | null }): 'retry' | null {
  if (!x.acrossRestart || x.stopped || x.restartRetryRound === x.round) return null;
  return x.verdict === null || x.verdict === 'lab-error' || (x.verdict === 'fail' && x.cause === 'lab-error') ? 'retry' : null;
}

/** A conflict found before QA tested the head: the head it was found on, and the fixReason of the test QA was queued for. */
export interface PreQa {
  sha: string;
  fixReason: 'qa' | 'checks' | 'conflict' | null;
}

/**
 * What happens before a queued PR goes to a tester, so QA never spends a session on a stale branch. test: go ahead.
 * update-branch: the repo only merges up-to-date branches, so GitHub merges the base in first, as the merge gate does.
 * send-back: it conflicts, so its developer merges the base first (never the manager, and no merge fix spent: #275).
 * People's own PRs are theirs: QA tests them as they are.
 */
export type QaGate = { do: 'test' } | { do: 'update-branch' } | { do: 'send-back' };

export function qaGate(pr: QaPull & { headRefName: string }, autoMerge: boolean): QaGate {
  if (!pr.headRefName.startsWith('swarm/')) return { do: 'test' };
  if (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY') return { do: 'send-back' };
  if (autoMerge && pr.mergeState === 'BEHIND') return { do: 'update-branch' };
  return { do: 'test' };
}

/** What the developer is told on a conflict send-back: QA's findings first, then the merge. */
export function conflictFixInstructions(qaInstructions: string, base: string): string {
  const merge = `It also conflicts with ${base}: bring it up to date (git fetch origin && git merge origin/${base}) and resolve the conflicts so both this change and the newly merged work keep working.`;
  return qaInstructions.trim() ? `${qaInstructions.trim()}\n\n${merge}` : merge;
}
