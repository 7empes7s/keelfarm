import { describe, expect, it } from 'vitest';
import { QA_STOPPED } from './prOwnership.ts';
import { clampStuckRecheckMin, DEFAULT_STUCK_RECHECK_MIN, RETRIAGE_MS, stuckRecheck, type StuckPull, type StuckRecord } from './stuckRecheck.ts';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const AGE = DEFAULT_STUCK_RECHECK_MIN * MIN;

const rec = (o: Partial<StuckRecord> = {}): StuckRecord => ({ status: 'needs-human', passedSha: 'abc123', summary: 'All good.', stuckWhy: 'it still fails its checks after 5 fixes', stuckAt: NOW - AGE, ...o });
const pull = (o: Partial<StuckPull> = {}): StuckPull => ({ state: 'OPEN', headRefName: 'swarm/issue-7-ada', mergeable: 'MERGEABLE', mergeState: 'CLEAN', checks: 'passing', failedChecks: [], ...o });

describe('stuckRecheck', () => {
  it('sends a QA-passed PR that only conflicts now back to a developer once it has waited the re-check time', () => {
    expect(stuckRecheck(rec(), pull({ mergeable: 'CONFLICTING' }), NOW, AGE)).toBe('conflict');
    expect(stuckRecheck(rec(), pull({ mergeState: 'DIRTY', checks: 'failing' }), NOW, AGE)).toBe('conflict');
    expect(stuckRecheck(rec({ stuckAt: NOW - AGE + MIN }), pull({ mergeable: 'CONFLICTING' }), NOW, AGE)).toBe('wait');
  });

  it('releases one whose checks are green, running, or never started (an outage) to the merge gate', () => {
    expect(stuckRecheck(rec(), pull(), NOW, AGE)).toBe('merge-gate');
    expect(stuckRecheck(rec(), pull({ checks: 'pending' }), NOW, AGE)).toBe('merge-gate');
    expect(stuckRecheck(rec(), pull({ checks: 'failing', failedChecks: [{ name: 'ci', url: null, neverStarted: true }] }), NOW, AGE)).toBe('merge-gate');
  });

  it('releases everything a conflict or an outage holds on the one-off pass, whatever its age', () => {
    expect(stuckRecheck(rec({ stuckAt: NOW - MIN }), pull({ mergeable: 'CONFLICTING' }), NOW, 0)).toBe('conflict');
  });

  it('gives anything else back to the CEO, at most every two hours', () => {
    const red = pull({ checks: 'failing', failedChecks: [{ name: 'ci', url: null }] });
    expect(stuckRecheck(rec(), red, NOW, AGE)).toBe('wait'); // stuck 30 min ago, so the CEO's triage then is recent
    expect(stuckRecheck(rec({ stuckAt: NOW - RETRIAGE_MS }), red, NOW, AGE)).toBe('retriage');
    expect(stuckRecheck(rec({ stuckAt: NOW - 5 * RETRIAGE_MS, recheckAt: NOW - RETRIAGE_MS + MIN }), red, NOW, AGE)).toBe('wait');
    expect(stuckRecheck(rec({ stuckAt: NOW - RETRIAGE_MS + MIN, recheckAt: NOW - 9 * RETRIAGE_MS }), red, NOW, AGE)).toBe('wait'); // stuck again since the last re-check
  });

  it('keeps a real QA failure with the manager even when it also conflicts: never released, only re-triaged', () => {
    const failedQa = rec({ passedSha: null, stuckWhy: 'it failed QA 6 times', stuckAt: NOW - RETRIAGE_MS });
    expect(stuckRecheck(failedQa, pull({ mergeable: 'CONFLICTING' }), NOW, AGE)).toBe('retriage');
    expect(stuckRecheck(failedQa, pull(), NOW, 0)).toBe('retriage');
  });

  it("leaves the manager's own stop, a broken desk, people's own PRs and closed PRs alone", () => {
    expect(stuckRecheck(rec({ summary: QA_STOPPED, stuckAt: NOW - RETRIAGE_MS }), pull({ mergeable: 'CONFLICTING' }), NOW, AGE)).toBe('wait');
    expect(stuckRecheck(rec({ stuckWhy: "its desk couldn't be set up" }), pull(), NOW, AGE)).toBe('wait');
    expect(stuckRecheck(rec(), pull({ headRefName: 'feature/x', mergeable: 'CONFLICTING' }), NOW, AGE)).toBe('wait');
    expect(stuckRecheck(rec(), pull({ state: 'MERGED' }), NOW, AGE)).toBe('wait');
    expect(stuckRecheck(rec(), undefined, NOW, AGE)).toBe('wait');
    expect(stuckRecheck(rec({ status: 'failed' }), pull(), NOW, AGE)).toBe('wait');
  });

  it('clamps the setting to 5 minutes to a day', () => {
    expect(clampStuckRecheckMin(2)).toBe(5);
    expect(clampStuckRecheckMin('45')).toBe(45);
    expect(clampStuckRecheckMin(99_999)).toBe(1440);
    expect(clampStuckRecheckMin(undefined)).toBe(DEFAULT_STUCK_RECHECK_MIN);
  });
});
