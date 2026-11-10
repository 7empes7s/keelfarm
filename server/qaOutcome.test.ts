import { describe, expect, it } from 'vitest';
import { fixOutcome, type FixRecord } from './fixOutcome.ts';
import { MAX_MERGE_FIXES, mergeStep } from './mergeGate.ts';
import { conflictFixInstructions, labErrorNext, lastQaRound, MAX_QA_ROUNDS, qaGate, qaOutcome, qaRoundResult, restartLossNext, type QaPull, type QaRoundRecord } from './qaOutcome.ts';

const CONFLICTING: QaPull = { mergeable: 'CONFLICTING', mergeState: 'DIRTY' };
const MERGEABLE: QaPull = { mergeable: 'MERGEABLE', mergeState: 'CLEAN' };
const record = (r: Partial<QaRoundRecord> = {}): QaRoundRecord => ({ round: 1, retests: 0, mergeFixes: 0, ...r });
const last = (r: Partial<QaRoundRecord> = {}) => record({ round: MAX_QA_ROUNDS, ...r });

describe('qaOutcome', () => {
  it('sends a fail on the last QA round while the PR conflicts back as a conflict fix', () => {
    expect(qaOutcome(false, last(), CONFLICTING)).toBe('conflict');
    expect(qaOutcome(false, last(), { mergeable: 'UNKNOWN', mergeState: 'DIRTY' })).toBe('conflict');
    expect(qaOutcome(false, last({ mergeFixes: MAX_MERGE_FIXES - 1 }), CONFLICTING)).toBe('conflict');
  });

  it('sends a fail on the last QA round while the PR is mergeable to the manager, as before', () => {
    expect(qaOutcome(false, last(), MERGEABLE)).toBe('needs-human');
    expect(qaOutcome(false, last(), { mergeable: 'UNKNOWN', mergeState: 'UNKNOWN' })).toBe('needs-human');
    expect(qaOutcome(false, last(), null)).toBe('needs-human'); // GitHub couldn't be asked
  });

  it('sends a fail while conflicting to the manager once the merge-fix budget is used up', () => {
    expect(qaOutcome(false, last({ mergeFixes: MAX_MERGE_FIXES }), CONFLICTING)).toBe('needs-human');
  });

  it('sends an earlier fail back to the developer, conflicting or not', () => {
    expect(qaOutcome(false, record(), CONFLICTING)).toBe('failed');
    expect(qaOutcome(false, record({ round: MAX_QA_ROUNDS + 1, retests: 2 }), MERGEABLE)).toBe('failed');
  });

  it("counts only QA's own rounds, not the office's re-tests", () => {
    expect(lastQaRound(record({ round: MAX_QA_ROUNDS, retests: 1 }))).toBe(false);
    expect(lastQaRound(record({ round: MAX_QA_ROUNDS + 1, retests: 1 }))).toBe(true);
    expect(lastQaRound(record({ round: MAX_QA_ROUNDS + 2, retests: 0 }))).toBe(true); // the extra round after a conflict send-back
  });

  it("passes a PR while it conflicts, leaving the conflict to the merge gate's existing path", () => {
    expect(qaOutcome(true, last(), CONFLICTING)).toBe('passed');
    expect(qaOutcome(true, last({ mergeFixes: MAX_MERGE_FIXES }), CONFLICTING)).toBe('passed');
    const rec = { passedSha: 'a'.repeat(40), mergeFixes: 0, pendingSince: null, mergeRetryAt: null, alerted: false, rerunSha: null, rerunAt: null };
    const pr = { ...CONFLICTING, isDraft: false, headSha: rec.passedSha, checks: 'passing' as const, failedChecks: [], pendingChecks: [] };
    expect(mergeStep(pr, rec, 0, { base: 'main' })).toMatchObject({ do: 'send-back', reason: 'conflict', needsHuman: false });
  });
});

describe('failed QA with conflicts (#275)', () => {
  it('exhausts the budget through repeated QA failures and pushed fixes', () => {
    const rec = { ...record(), prNumber: 7, sessionFailures: 0, testedSha: 'head-1', passedSha: null, fixReason: 'qa', preQa: null, qaChecks: null } satisfies QaRoundRecord & FixRecord;
    const outcomes = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = qaRoundResult(false, rec, CONFLICTING);
      outcomes.push(result.next);
      Object.assign(rec, { mergeFixes: result.mergeFixes, fixReason: result.next === 'conflict' ? 'conflict' : 'qa' });
      if (result.next === 'needs-human') break;
      const head = `head-${rec.round + 1}`;
      const fix = fixOutcome(rec, head, 1);
      expect(fix.pushed).toBe(true);
      expect(fix.set.status).toBe('queued');
      Object.assign(rec, fix.set, { testedSha: head });
    }
    expect(outcomes).toEqual([
      ...Array(MAX_QA_ROUNDS - 1).fill('failed'),
      ...Array(MAX_MERGE_FIXES).fill('conflict'),
      'needs-human',
    ]);
    expect(rec).toMatchObject({ round: MAX_QA_ROUNDS + MAX_MERGE_FIXES, retests: 0, mergeFixes: MAX_MERGE_FIXES });
  });

  it('does not spend another merge fix on a pass or an ordinary QA failure', () => {
    expect(qaRoundResult(true, last(), CONFLICTING)).toEqual({ next: 'passed', mergeFixes: 0 });
    expect(qaRoundResult(false, record(), CONFLICTING)).toEqual({ next: 'failed', mergeFixes: 0 });
    expect(qaRoundResult(false, last(), MERGEABLE)).toEqual({ next: 'needs-human', mergeFixes: 0 });
  });
});

describe('the budgets', () => {
  it('gives QA six rounds and the merge gate five fixes', () => {
    expect(MAX_QA_ROUNDS).toBe(6);
    expect(MAX_MERGE_FIXES).toBe(5);
    expect(qaOutcome(false, record({ round: 5 }), MERGEABLE)).toBe('failed'); // a round-4 or round-5 gap goes back to its developer
    expect(qaOutcome(false, record({ round: 6 }), MERGEABLE)).toBe('needs-human');
  });
});

describe('qaGate: conflicts before QA', () => {
  const pull = (p: Partial<QaPull> = {}, headRefName = 'swarm/issue-7-ada') => ({ ...MERGEABLE, headRefName, ...p });

  it('sends a conflicting PR to its developer before a tester spends a session on it', () => {
    expect(qaGate(pull(CONFLICTING), true)).toEqual({ do: 'send-back' });
    expect(qaGate(pull({ mergeable: 'UNKNOWN', mergeState: 'DIRTY' }), false)).toEqual({ do: 'send-back' });
    expect(qaGate(pull({ mergeable: 'CONFLICTING', mergeState: 'UNKNOWN' }), true)).toEqual({ do: 'send-back' });
  });

  it('updates a branch that is only behind, as the merge gate does (auto-merge floors)', () => {
    expect(qaGate(pull({ mergeState: 'BEHIND' }), true)).toEqual({ do: 'update-branch' });
    expect(qaGate(pull({ mergeState: 'BEHIND' }), false)).toEqual({ do: 'test' });
  });

  it('tests a mergeable PR, or one GitHub is still working out', () => {
    expect(qaGate(pull(), true)).toEqual({ do: 'test' });
    expect(qaGate(pull({ mergeable: 'UNKNOWN', mergeState: 'UNKNOWN' }), true)).toEqual({ do: 'test' });
    expect(qaGate(pull({ mergeState: 'BLOCKED' }), true)).toEqual({ do: 'test' });
  });

  it("leaves people's own PRs alone", () => {
    expect(qaGate(pull(CONFLICTING, 'feature/login'), true)).toEqual({ do: 'test' });
    expect(qaGate(pull({ mergeState: 'BEHIND' }, 'feature/login'), true)).toEqual({ do: 'test' });
  });
});

describe('conflictFixInstructions', () => {
  it("keeps QA's findings and adds the merge", () => {
    expect(conflictFixInstructions('Make the toolbar wrap.\n', 'main')).toBe(
      'Make the toolbar wrap.\n\nIt also conflicts with main: bring it up to date (git fetch origin && git merge origin/main) and resolve the conflicts so both this change and the newly merged work keep working.',
    );
    expect(conflictFixInstructions('', 'trunk')).toMatch(/^It also conflicts with trunk: .*git merge origin\/trunk/);
  });
});

describe('labErrorNext (#189)', () => {
  it('sends a lab error back to QA by itself once per round, then to triage', () => {
    expect(labErrorNext({ round: 2, labRetryRound: null })).toBe('retry');
    expect(labErrorNext({ round: 2, labRetryRound: 2 })).toBe('stuck');
    expect(labErrorNext({ round: 3, labRetryRound: 2 })).toBe('retry'); // a new round (fixes pushed) gets its own retry
  });
});

describe('restartLossNext (#333)', () => {
  const lost = { acrossRestart: true, stopped: false, verdict: null, round: 3, restartRetryRound: null } as const;

  it('re-queues a round that lost its lab to an office restart, once a round', () => {
    expect(restartLossNext(lost)).toBe('retry'); // no report
    expect(restartLossNext({ ...lost, verdict: 'lab-error' })).toBe('retry');
    expect(restartLossNext({ ...lost, verdict: 'fail', cause: 'lab-error' })).toBe('retry');
    expect(restartLossNext({ ...lost, restartRetryRound: 3 })).toBeNull(); // already re-run this round
    expect(restartLossNext({ ...lost, restartRetryRound: 2 })).toBe('retry'); // a new round gets its own
  });

  it('leaves real verdicts, rounds with no restart and stopped sessions alone', () => {
    expect(restartLossNext({ ...lost, verdict: 'fail', cause: 'bug' })).toBeNull();
    expect(restartLossNext({ ...lost, verdict: 'pass' })).toBeNull();
    expect(restartLossNext({ ...lost, acrossRestart: false })).toBeNull();
    expect(restartLossNext({ ...lost, stopped: true })).toBeNull();
  });
});
