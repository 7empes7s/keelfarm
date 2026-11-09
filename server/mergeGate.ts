import { upToDateStep } from '../shared/practices.ts';
import type { PullInfo } from '../shared/types.ts';

// Auto-merge: fixes for failing checks before a PR needs the manager (a conflict with the base never does, and its
// rounds don't count toward the fixes, #275: finished work only needs bringing up to date), how long checks may run before
// the manager hears about it, and how long to wait before retrying a merge GitHub refused. Failing checks are first
// re-run once per head commit (a flake or an outage shouldn't cost a fix), and a re-run's old result is ignored for
// a while, since GitHub's rollup can still show it just after the re-run starts.
export const MAX_MERGE_FIXES = 5;
export const CHECKS_ALERT_MS = 30 * 60_000;
export const MERGE_RETRY_MS = 10 * 60_000;
export const RERUN_GRACE_MS = 2 * 60_000;

// CI outages (#191): GitHub ending a check run within seconds without running it (billing, spending limit, Actions
// off) says nothing about the PR. QA-passed PRs it hits are parked: no fix, no fix count, no escalation. One parked PR
// is re-run every OUTAGE_PROBE_MS; once a run really starts (still running OUTAGE_STARTED_MS after its re-run, or
// finished), the rest are re-run oldest first, one at a time, and merge through the normal gate.
export const NEVER_STARTED_MS = 5_000;
export const OUTAGE_PROBE_MS = 5 * 60_000;
export const OUTAGE_STARTED_MS = 60_000;
export const NEVER_STARTED = 'GitHub ended the checks without starting them';
const OUTAGE_TEXT = /billing|spending limit|payments? (have|has) failed/i;

/** The parts of a QA record the merge gate reads. */
export interface MergeRecord {
  passedSha: string | null;
  mergeFixes: number;
  pendingSince: number | null;
  mergeRetryAt: number | null;
  alerted: boolean;
  rerunSha: string | null; // the head commit whose failed checks the office re-ran
  rerunAt: number | null; // when it did
  updatedSha?: string | null; // the head the office made by bringing the PR up to date with its base (#24)
  ciOutage?: number | null; // parked by a CI outage since then (#191)
}

/** Bookkeeping the caller writes onto the record as it is (it doesn't count as a change to the record). */
export type MergeBookkeeping = Partial<Pick<MergeRecord, 'passedSha' | 'pendingSince' | 'alerted'>>;

export type MergePull = Pick<PullInfo, 'isDraft' | 'mergeable' | 'mergeState' | 'headSha' | 'checks' | 'failedChecks' | 'pendingChecks'>;

/** What auto-merge does next with a QA-passed PR. */
export type MergeStep = { set: MergeBookkeeping } & (
  | { do: 'wait'; note?: string; alert?: boolean } // no note: leave the card as it is; alert: tell the manager checks are slow
  | { do: 'details' } // GitHub hasn't worked out mergeability: ask about the PR itself, then decide again with `detailed`
  | { do: 'requeue' } // commits arrived after QA's sign-off: QA tests them too
  | { do: 'rerun'; runIds: number[]; reason: 'checks'; instructions: string; needsHuman: boolean } // re-run these Actions runs' failed jobs; the rest is the send-back if that can't be done
  | { do: 'send-back'; reason: 'checks' | 'conflict'; instructions: string; needsHuman: boolean; counts: boolean } // needsHuman: the fix budget ran out; counts: it uses one of MAX_MERGE_FIXES
  | { do: 'outage'; runIds: number[]; reason: string } // GitHub didn't run its checks: park it until CI is back (#191)
  | { do: 'update-branch' } // the repo only merges up-to-date branches, or the floor wants every PR up to date (#24)
  | { do: 'behind' } // up to date before merge: ask how far behind its base it is, then decide again with `behind`
  | { do: 'merge' }
);

/**
 * Decide the next step toward merging a PR QA has passed. Pure: advanceMerge (swarm.ts) does the talking to GitHub
 * and the office. `detailed` means the PR's mergeability has already been asked for, so UNKNOWN is waited out.
 */
export function mergeStep(pr: MergePull, rec: MergeRecord, now: number, opts: { base: string; detailed?: boolean; upToDate?: boolean; behind?: number | null; outage?: string | null }): MergeStep {
  if (pr.isDraft) return { do: 'wait', note: 'a draft: waiting', set: {} };
  if (!opts.detailed && (pr.mergeable === 'UNKNOWN' || pr.mergeState === 'UNKNOWN')) return { do: 'details', set: {} };
  const set: MergeBookkeeping = {};
  if (rec.passedSha == null) set.passedSha = pr.headSha; // signed off before the office tracked commits
  if (pr.headSha !== (set.passedSha ?? rec.passedSha)) return { do: 'requeue', set };
  const needsHuman = rec.mergeFixes >= MAX_MERGE_FIXES;
  if (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY') {
    return { do: 'send-back', reason: 'conflict', instructions: `It conflicts with ${opts.base}.`, needsHuman: false, counts: false, set };
  }
  const rerun = rec.rerunSha === pr.headSha;
  if (pr.checks === 'failing') {
    const instructions = pr.failedChecks.map((c) => `- ${c.name}${c.url ? `: ${c.url}` : ''}`).join('\n');
    const runIds = failedRunIds(pr.failedChecks);
    if (rerun && rec.rerunAt != null && now - rec.rerunAt < RERUN_GRACE_MS) return { do: 'wait', note: 're-running a failed check', set };
    const outage = opts.outage ?? (neverStarted(pr) ? NEVER_STARTED : null);
    if (outage) return { do: 'outage', runIds, reason: outage, set };
    if (!rerun && runIds.length) return { do: 'rerun', runIds, reason: 'checks', instructions, needsHuman, set };
    // It only fails on the office's merge of the base: the change conflicts with newer work there, not QA's verdict.
    if (opts.upToDate && rec.updatedSha === pr.headSha) return { do: 'send-back', reason: 'conflict', instructions: `It conflicts with ${opts.base}: after merging ${opts.base} into it, these checks fail:\n${instructions}`, needsHuman, counts: true, set };
    return { do: 'send-back', reason: 'checks', instructions, needsHuman, counts: true, set };
  }
  if (pr.checks === 'pending') {
    const since = rec.pendingSince ?? now;
    if (rec.pendingSince == null) set.pendingSince = since;
    const alert = now - since > CHECKS_ALERT_MS && !rec.alerted;
    if (alert) set.alerted = true;
    const running = pr.pendingChecks.join(', ') || 'running';
    return { do: 'wait', note: rerun ? `re-running a failed check: ${running}` : `waiting for checks: ${running}`, alert, set };
  }
  set.pendingSince = null;
  if (pr.mergeable === 'UNKNOWN') return { do: 'wait', note: 'GitHub is checking it can merge', set };
  if (pr.mergeState === 'BEHIND') return { do: 'update-branch', set };
  if (opts.upToDate) {
    const up = upToDateStep(pr, opts.behind ?? null);
    if (up === 'unknown') return { do: 'behind', set };
    if (up === 'update') return { do: 'update-branch', set };
  }
  if (rec.mergeRetryAt && now < rec.mergeRetryAt) return { do: 'wait', set };
  return { do: 'merge', set };
}

/** The GitHub Actions runs behind failed checks (from their log URLs), once each. Other checks can't be re-run from here. */
export function failedRunIds(failed: MergePull['failedChecks']): number[] {
  const ids = failed.map((c) => c.url?.match(/\/actions\/runs\/(\d+)/)?.[1]).filter((id): id is string => !!id);
  return [...new Set(ids)].map(Number);
}

// ---------- CI outages (#191) ----------

/** Every failed check is one GitHub never started. */
function neverStarted(pr: Pick<MergePull, 'checks' | 'failedChecks'>): boolean {
  return pr.checks === 'failing' && pr.failedChecks.length > 0 && pr.failedChecks.every((c) => c.neverStarted);
}

/** GitHub's annotation saying it wouldn't run a job (billing, spending limit), clipped for the banner; else null. */
export function outageReason(messages: string[]): string | null {
  const m = messages.find((t) => OUTAGE_TEXT.test(t));
  return m ? m.replace(/\s+/g, ' ').trim().slice(0, 200) : null;
}

/** Where a parked PR's checks stand: still refused, a re-run not yet known to have started, or really running/finished. */
export function parkedState(pr: Pick<MergePull, 'checks' | 'failedChecks'>, rec: Pick<MergeRecord, 'rerunAt'>, now: number): ParkedPull['state'] | 'started' {
  const since = now - (rec.rerunAt ?? 0);
  if (pr.checks === 'failing') return since < RERUN_GRACE_MS ? 'rerunning' : neverStarted(pr) ? 'down' : 'started';
  if (pr.checks === 'pending') return since < OUTAGE_STARTED_MS ? 'rerunning' : 'started';
  return 'started';
}

export interface ParkedPull {
  prNumber: number;
  parkedAt: number;
  rerunAt: number | null;
  state: 'down' | 'rerunning';
}

/** A floor's outage clock: its last probe, and when a run was last seen really starting (null: CI still down). */
export interface OutageClock {
  probeAt: number | null;
  back: number | null;
}

/**
 * Which parked PR to re-run now, oldest first and one at a time: a probe every OUTAGE_PROBE_MS while CI is down, the
 * next one as soon as the last re-run started once CI is back. A re-run refused again after CI came back means it's down again.
 */
export function outageRerun(parked: ParkedPull[], clock: OutageClock, now: number): { rerun: number | null; back: number | null } {
  let back = clock.back;
  if (back != null && parked.some((p) => p.state === 'down' && p.rerunAt != null && p.rerunAt >= back!)) back = null;
  if (!parked.length || parked.some((p) => p.state === 'rerunning')) return { rerun: null, back };
  if (back == null && clock.probeAt != null && now - clock.probeAt < OUTAGE_PROBE_MS) return { rerun: null, back };
  const next = [...parked].sort((a, b) => a.parkedAt - b.parkedAt || a.prNumber - b.prNumber)[0];
  return { rerun: next.prNumber, back };
}

/** Needs-human only because its checks kept failing after QA passed it (as in the outage before #191): back to the merge gate, which re-runs them once. */
export function releasedAfterOutage(rec: { status: string; passedSha: string | null; fixReason: string | null; stuckWhy: string | null }): boolean {
  return rec.status === 'needs-human' && !!rec.passedSha && rec.fixReason === 'checks' && /fails its checks after/.test(rec.stuckWhy ?? '');
}
