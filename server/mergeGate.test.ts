import { describe, expect, it } from 'vitest';
import {
  CHECKS_ALERT_MS,
  MAX_MERGE_FIXES,
  NEVER_STARTED,
  OUTAGE_PROBE_MS,
  OUTAGE_STARTED_MS,
  RERUN_GRACE_MS,
  failedRunIds,
  mergeStep,
  outageReason,
  outageRerun,
  parkedState,
  releasedAfterOutage,
  type MergePull,
  type MergeRecord,
  type ParkedPull,
} from './mergeGate.ts';

const NOW = 1_800_000_000_000;
const base = { base: 'main' };

const pull = (p: Partial<MergePull> = {}): MergePull => ({
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeState: 'CLEAN',
  headSha: 'abc123',
  checks: 'passing',
  failedChecks: [],
  pendingChecks: [],
  ...p,
});

const record = (r: Partial<MergeRecord> = {}): MergeRecord => ({
  passedSha: 'abc123',
  mergeFixes: 0,
  pendingSince: null,
  mergeRetryAt: null,
  alerted: false,
  rerunSha: null,
  rerunAt: null,
  ...r,
});

describe('mergeStep', () => {
  it('merges a clean, green PR at the commit QA passed', () => {
    expect(mergeStep(pull(), record(), NOW, base)).toEqual({ do: 'merge', set: { pendingSince: null } });
    expect(mergeStep(pull({ checks: 'none' }), record(), NOW, base).do).toBe('merge');
  });

  it('waits on a draft without touching the record', () => {
    expect(mergeStep(pull({ isDraft: true, mergeable: 'CONFLICTING', headSha: 'other' }), record({ passedSha: null }), NOW, base)).toEqual({
      do: 'wait',
      note: 'a draft: waiting',
      set: {},
    });
  });

  describe('UNKNOWN mergeability', () => {
    it('asks GitHub about the PR first', () => {
      expect(mergeStep(pull({ mergeable: 'UNKNOWN' }), record(), NOW, base)).toEqual({ do: 'details', set: {} });
      expect(mergeStep(pull({ mergeState: 'UNKNOWN' }), record(), NOW, base)).toEqual({ do: 'details', set: {} });
    });

    it('waits when the details still say UNKNOWN', () => {
      expect(mergeStep(pull({ mergeable: 'UNKNOWN', mergeState: 'UNKNOWN' }), record(), NOW, { ...base, detailed: true })).toEqual({
        do: 'wait',
        note: 'GitHub is checking it can merge',
        set: { pendingSince: null },
      });
    });

    it('carries on with the details once GitHub knows', () => {
      expect(mergeStep(pull({ mergeState: 'UNKNOWN' }), record(), NOW, { ...base, detailed: true }).do).toBe('merge');
      expect(mergeStep(pull({ mergeable: 'CONFLICTING' }), record(), NOW, { ...base, detailed: true }).do).toBe('send-back');
    });
  });

  describe('head moved after QA', () => {
    it('sends the PR back to QA', () => {
      expect(mergeStep(pull({ headSha: 'new456' }), record(), NOW, base)).toEqual({ do: 'requeue', set: {} });
    });

    it('re-tests even when the new commit also conflicts or fails', () => {
      expect(mergeStep(pull({ headSha: 'new456', mergeable: 'CONFLICTING', checks: 'failing' }), record(), NOW, base).do).toBe('requeue');
    });

    it('adopts the head as the passed commit for records from before commits were tracked', () => {
      expect(mergeStep(pull({ headSha: 'def789' }), record({ passedSha: null }), NOW, base)).toEqual({
        do: 'merge',
        set: { passedSha: 'def789', pendingSince: null },
      });
    });
  });

  describe('conflicts', () => {
    for (const p of [{ mergeable: 'CONFLICTING' }, { mergeState: 'DIRTY' }]) {
      it(`sends back ${JSON.stringify(p)} to a developer`, () => {
        expect(mergeStep(pull(p), record({ mergeFixes: 1 }), NOW, { base: 'develop' })).toEqual({
          do: 'send-back',
          reason: 'conflict',
          instructions: 'It conflicts with develop.',
          needsHuman: false,
          set: {},
        });
      });
    }

    it('wins over failing and pending checks', () => {
      expect(mergeStep(pull({ mergeable: 'CONFLICTING', checks: 'failing' }), record(), NOW, base)).toMatchObject({ reason: 'conflict' });
      expect(mergeStep(pull({ mergeState: 'DIRTY', checks: 'pending' }), record(), NOW, base)).toMatchObject({ reason: 'conflict' });
    });
  });

  describe('failing checks', () => {
    const red = pull({
      checks: 'failing',
      failedChecks: [
        { name: 'check (ubuntu-latest)', url: 'https://github.com/o/r/actions/runs/1/job/2' },
        { name: 'lint', url: null },
      ],
    });
    const instructions = '- check (ubuntu-latest): https://github.com/o/r/actions/runs/1/job/2\n- lint';

    it('re-runs the failed Actions runs the first time they fail on a commit', () => {
      expect(mergeStep(red, record(), NOW, base)).toEqual({ do: 'rerun', runIds: [1], reason: 'checks', instructions, needsHuman: false, set: {} });
      expect(mergeStep(red, record({ mergeFixes: MAX_MERGE_FIXES }), NOW, base)).toMatchObject({ do: 'rerun', needsHuman: true });
    });

    it('re-runs again on a new commit: the budget is per commit', () => {
      expect(mergeStep(red, record({ rerunSha: 'old999', rerunAt: NOW - 1 }), NOW, base).do).toBe('rerun');
    });

    it('waits out the old result just after the re-run', () => {
      expect(mergeStep(red, record({ rerunSha: 'abc123', rerunAt: NOW - RERUN_GRACE_MS + 1 }), NOW, base)).toEqual({ do: 'wait', note: 're-running a failed check', set: {} });
    });

    it('says the checks are re-running while they run again', () => {
      expect(mergeStep(pull({ checks: 'pending', pendingChecks: ['e2e'] }), record({ rerunSha: 'abc123', rerunAt: NOW - 1 }), NOW, base)).toMatchObject({
        do: 'wait',
        note: 're-running a failed check: e2e',
      });
    });

    it('sends the PR back when they fail again on the same commit, listing each failed check with its log URL when there is one', () => {
      expect(mergeStep(red, record({ rerunSha: 'abc123', rerunAt: NOW - RERUN_GRACE_MS }), NOW, base)).toEqual({
        do: 'send-back',
        reason: 'checks',
        instructions,
        needsHuman: false,
        set: {},
      });
    });

    it('sends the PR back at once when no failed check can be re-run from here', () => {
      expect(mergeStep(pull({ checks: 'failing', failedChecks: [{ name: 'Vercel', url: 'https://vercel.com/o/r/abc' }] }), record(), NOW, base)).toMatchObject({
        do: 'send-back',
        reason: 'checks',
      });
    });
  });

  describe('failedRunIds', () => {
    it('reads each Actions run once from the log URLs', () => {
      expect(
        failedRunIds([
          { name: 'a', url: 'https://github.com/o/r/actions/runs/123/job/1' },
          { name: 'b', url: 'https://github.com/o/r/actions/runs/123/job/2' },
          { name: 'c', url: 'https://github.com/o/r/actions/runs/456' },
          { name: 'd', url: 'https://vercel.com/x' },
          { name: 'e', url: null },
        ]),
      ).toEqual([123, 456]);
    });
  });

  describe('fix budget', () => {
    it(`needs a human after ${MAX_MERGE_FIXES} fixes`, () => {
      expect(mergeStep(pull({ checks: 'failing' }), record({ mergeFixes: MAX_MERGE_FIXES - 1 }), NOW, base)).toMatchObject({ needsHuman: false });
      expect(mergeStep(pull({ checks: 'failing' }), record({ mergeFixes: MAX_MERGE_FIXES }), NOW, base)).toMatchObject({ do: 'send-back', needsHuman: true });
      expect(mergeStep(pull({ mergeable: 'CONFLICTING' }), record({ mergeFixes: MAX_MERGE_FIXES + 1 }), NOW, base)).toMatchObject({ reason: 'conflict', needsHuman: true });
    });
  });

  describe('pending checks', () => {
    it('starts the clock and names the running checks', () => {
      expect(mergeStep(pull({ checks: 'pending', pendingChecks: ['build', 'test'] }), record(), NOW, base)).toEqual({
        do: 'wait',
        note: 'waiting for checks: build, test',
        alert: false,
        set: { pendingSince: NOW },
      });
    });

    it('says "running" when GitHub names none', () => {
      expect(mergeStep(pull({ checks: 'pending' }), record(), NOW, base)).toMatchObject({ note: 'waiting for checks: running' });
    });

    it('keeps the clock it already started', () => {
      expect(mergeStep(pull({ checks: 'pending' }), record({ pendingSince: NOW - 60_000 }), NOW, base)).toMatchObject({ alert: false, set: {} });
    });

    it(`alerts the manager once after ${CHECKS_ALERT_MS / 60_000} minutes`, () => {
      const pr = pull({ checks: 'pending', pendingChecks: ['e2e'] });
      expect(mergeStep(pr, record({ pendingSince: NOW - CHECKS_ALERT_MS }), NOW, base)).toMatchObject({ alert: false, set: {} });
      expect(mergeStep(pr, record({ pendingSince: NOW - CHECKS_ALERT_MS - 1 }), NOW, base)).toEqual({
        do: 'wait',
        note: 'waiting for checks: e2e',
        alert: true,
        set: { alerted: true },
      });
      expect(mergeStep(pr, record({ pendingSince: NOW - CHECKS_ALERT_MS - 1, alerted: true }), NOW, base)).toMatchObject({ alert: false, set: {} });
    });

    it('stops the clock once checks finish', () => {
      expect(mergeStep(pull(), record({ pendingSince: NOW - 5_000 }), NOW, base).set).toEqual({ pendingSince: null });
    });
  });

  describe('BEHIND', () => {
    it('updates the branch instead of merging', () => {
      expect(mergeStep(pull({ mergeState: 'BEHIND' }), record(), NOW, base)).toEqual({ do: 'update-branch', set: { pendingSince: null } });
    });

    it('waits for checks before updating', () => {
      expect(mergeStep(pull({ mergeState: 'BEHIND', checks: 'pending' }), record(), NOW, base).do).toBe('wait');
    });
  });

  describe('merge retry window', () => {
    it('leaves the card alone until the retry time', () => {
      expect(mergeStep(pull(), record({ mergeRetryAt: NOW + 1 }), NOW, base)).toEqual({ do: 'wait', set: { pendingSince: null } });
    });

    it('tries again once it has passed', () => {
      expect(mergeStep(pull(), record({ mergeRetryAt: NOW }), NOW, base).do).toBe('merge');
      expect(mergeStep(pull(), record({ mergeRetryAt: NOW - 1 }), NOW, base).do).toBe('merge');
    });

    it('still updates a branch that fell behind while waiting', () => {
      expect(mergeStep(pull({ mergeState: 'BEHIND' }), record({ mergeRetryAt: NOW + 60_000 }), NOW, base).do).toBe('update-branch');
    });
  });

  describe('up to date before merge (#24)', () => {
    const on = { base: 'main', upToDate: true };
    it('asks how far behind a green PR is, then updates it or merges it', () => {
      expect(mergeStep(pull(), record(), NOW, on).do).toBe('behind');
      expect(mergeStep(pull(), record(), NOW, { ...on, behind: 2 }).do).toBe('update-branch');
      expect(mergeStep(pull(), record(), NOW, { ...on, behind: 0 }).do).toBe('merge');
    });

    it('waits for CI on the updated result before anything else', () => {
      expect(mergeStep(pull({ checks: 'pending', pendingChecks: ['CI'] }), record(), NOW, on).do).toBe('wait');
    });

    it('a PR that fails only after the update goes back as a conflict with main, with the failing check', () => {
      const failed = pull({ headSha: 'merged1', checks: 'failing', failedChecks: [{ name: 'CI / test', url: null }] });
      const step = mergeStep(failed, record({ passedSha: 'merged1', updatedSha: 'merged1' }), NOW, on);
      expect(step).toMatchObject({ do: 'send-back', reason: 'conflict' });
      expect(step.do === 'send-back' && step.instructions).toMatch(/conflicts with main[\s\S]*CI \/ test/);
      // Its own commit failing is still a checks fix.
      expect(mergeStep(failed, record({ passedSha: 'merged1', updatedSha: 'other' }), NOW, on)).toMatchObject({ do: 'send-back', reason: 'checks' });
    });

    it('with the switch off, merges as today', () => {
      expect(mergeStep(pull(), record(), NOW, { base: 'main', behind: 5 }).do).toBe('merge');
      const failed = pull({ checks: 'failing', failedChecks: [{ name: 'CI', url: null }] });
      expect(mergeStep(failed, record({ updatedSha: 'abc123' }), NOW, base)).toMatchObject({ do: 'send-back', reason: 'checks' });
    });
  });
});

describe('CI outages (#191)', () => {
  const RUN = 'https://github.com/o/r/actions/runs/77/job/9';
  const refused = pull({ checks: 'failing', failedChecks: [{ name: 'CI / build', url: RUN, neverStarted: true }] });
  const BILLING = "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings.";

  it('a run GitHub never started is an outage: no re-run as a flake, no fix, no fix count, no manager', () => {
    for (const rec of [record(), record({ mergeFixes: MAX_MERGE_FIXES }), record({ rerunSha: 'abc123', rerunAt: NOW - RERUN_GRACE_MS })]) {
      expect(mergeStep(refused, rec, NOW, base)).toEqual({ do: 'outage', runIds: [77], reason: NEVER_STARTED, set: {} });
    }
  });

  it("GitHub's billing annotation makes a failed run an outage too", () => {
    const failed = pull({ checks: 'failing', failedChecks: [{ name: 'CI', url: RUN }] });
    const reason = outageReason(['Process completed with exit code 1.', BILLING]);
    expect(reason).toMatch(/^The job was not started because recent account payments have failed/);
    expect(mergeStep(failed, record({ rerunSha: 'abc123', rerunAt: NOW - RERUN_GRACE_MS }), NOW, { ...base, outage: reason })).toMatchObject({ do: 'outage', reason });
    expect(outageReason(['Process completed with exit code 1.'])).toBeNull();
  });

  it('a real failure, or one that only partly never started, is still a checks failure', () => {
    const real = pull({ checks: 'failing', failedChecks: [{ name: 'CI / build', url: RUN }] });
    expect(mergeStep(real, record(), NOW, base).do).toBe('rerun');
    const mixed = pull({ checks: 'failing', failedChecks: [{ name: 'CI / build', url: RUN, neverStarted: true }, { name: 'CI / lint', url: RUN }] });
    expect(mergeStep(mixed, record({ rerunSha: 'abc123', rerunAt: NOW - RERUN_GRACE_MS }), NOW, base)).toMatchObject({ do: 'send-back', reason: 'checks' });
  });

  it("where a parked PR's checks stand", () => {
    expect(parkedState(refused, { rerunAt: null }, NOW)).toBe('down');
    expect(parkedState(refused, { rerunAt: NOW - 1000 }, NOW)).toBe('rerunning'); // GitHub's rollup can still show the old result
    expect(parkedState(pull({ checks: 'pending', pendingChecks: ['CI'] }), { rerunAt: NOW - 1000 }, NOW)).toBe('rerunning');
    expect(parkedState(pull({ checks: 'pending', pendingChecks: ['CI'] }), { rerunAt: NOW - OUTAGE_STARTED_MS }, NOW)).toBe('started');
    expect(parkedState(pull(), { rerunAt: NOW - 1000 }, NOW)).toBe('started');
    expect(parkedState(pull({ checks: 'failing', failedChecks: [{ name: 'CI', url: RUN }] }), { rerunAt: NOW - RERUN_GRACE_MS }, NOW)).toBe('started');
  });

  it('a QA-passed parked PR merges once its checks go green, with no manager action', () => {
    const rec = record({ ciOutage: NOW - 3_600_000, rerunSha: 'abc123', rerunAt: NOW - OUTAGE_PROBE_MS, mergeFixes: MAX_MERGE_FIXES });
    expect(parkedState(pull(), rec, NOW)).toBe('started');
    expect(mergeStep(pull(), rec, NOW, base).do).toBe('merge');
  });

  describe('recovery', () => {
    const p = (prNumber: number, parkedAt: number, x: Partial<ParkedPull> = {}): ParkedPull => ({ prNumber, parkedAt, rerunAt: null, state: 'down', ...x });
    const parked = [p(12, NOW - 1000), p(7, NOW - 3000), p(9, NOW - 3000)];

    it('probes the oldest parked PR every few minutes while CI is down', () => {
      expect(outageRerun(parked, { probeAt: NOW - OUTAGE_PROBE_MS, back: null }, NOW)).toEqual({ rerun: 7, back: null });
      expect(outageRerun(parked, { probeAt: NOW - OUTAGE_PROBE_MS + 1000, back: null }, NOW)).toEqual({ rerun: null, back: null });
      expect(outageRerun([], { probeAt: null, back: null }, NOW).rerun).toBeNull();
    });

    it('once a run really started, re-runs the rest oldest first, one at a time', () => {
      const back = NOW - 10_000;
      expect(outageRerun(parked, { probeAt: NOW - 1000, back }, NOW)).toEqual({ rerun: 7, back });
      expect(outageRerun([p(7, NOW - 3000, { state: 'rerunning', rerunAt: NOW - 1000 }), p(9, NOW - 3000), p(12, NOW - 1000)], { probeAt: NOW - 1000, back }, NOW).rerun).toBeNull();
      expect(outageRerun([p(9, NOW - 3000), p(12, NOW - 1000)], { probeAt: NOW - 1000, back }, NOW).rerun).toBe(9);
    });

    it('a re-run refused again after CI came back means CI is down again', () => {
      const back = NOW - 10 * 60_000;
      expect(outageRerun([p(7, NOW - 3000, { rerunAt: back + 1000 }), p(9, NOW - 3000)], { probeAt: NOW - 1000, back }, NOW)).toEqual({ rerun: null, back: null });
    });
  });

  it('PRs an outage made needs-human before #191 go back to the merge gate once', () => {
    const stuck = { status: 'needs-human', passedSha: 'abc123', fixReason: 'checks', stuckWhy: `it still fails its checks after ${MAX_MERGE_FIXES} fixes` };
    expect(releasedAfterOutage(stuck)).toBe(true);
    expect(releasedAfterOutage({ ...stuck, passedSha: null })).toBe(false);
    expect(releasedAfterOutage({ ...stuck, fixReason: 'conflict', stuckWhy: `it still conflicts with main after ${MAX_MERGE_FIXES} fixes` })).toBe(false);
    expect(releasedAfterOutage({ ...stuck, status: 'passed' })).toBe(false);
  });
});
