import { describe, expect, it } from 'vitest';
import type { QaCheck } from '../../../shared/types';
import { charterViolation, checkTally, groupChecks, mergeRows, noQaWords, stateChip } from './detailsRules';

const check = (name: string, result: QaCheck['result']): QaCheck => ({ name, result, details: `${name} details` });

describe('groupChecks', () => {
  const report = [
    check('Unit tests', 'pass'),
    check('Phone layout', 'fail'),
    check('3D office', 'skip'),
    check('Lint', 'pass'),
    check('Console errors', 'fail'),
    { name: 'Charter check', result: 'fail', details: "violation: 'Screens work at 390px': the header is cut off" } as QaCheck,
  ];

  it('groups Failed, then Skipped, then Passed, in QA order within a group', () => {
    const { groups } = groupChecks(report);
    expect(groups.map((g) => g.id)).toEqual(['fail', 'skip', 'pass']);
    expect(groups[0].rows.map((r) => r.name)).toEqual(['Phone layout', 'Console errors']);
    expect(groups[2].rows.map((r) => r.name)).toEqual(['Unit tests', 'Lint']);
  });

  it('opens failed checks and leaves skipped and passed ones closed', () => {
    const open = Object.fromEntries(groupChecks(report).groups.map((g) => [g.id, g.rows.map((r) => r.open)]));
    expect(open).toEqual({ fail: [true, true], skip: [false], pass: [false, false] });
  });

  it('pulls a charter violation out into its own card naming the standard', () => {
    const { charter, groups } = groupChecks(report);
    expect(charter).toEqual([{ standard: "'Screens work at 390px'", why: 'the header is cut off' }]);
    expect(groups.flatMap((g) => g.rows).some((r) => r.name === 'Charter check')).toBe(false);
  });

  it('keeps a passed charter check with the passed ones, and drops empty groups', () => {
    const { charter, groups } = groupChecks([check('Charter check', 'pass')]);
    expect(charter).toEqual([]);
    expect(groups.map((g) => g.id)).toEqual(['pass']);
  });
});

describe('charterViolation', () => {
  it('reads a violation without a reason', () => {
    expect(charterViolation('Violation: no secrets committed')).toEqual({ standard: 'no secrets committed', why: '' });
  });
});

describe('checkTally', () => {
  it('counts passed out of all checks', () => {
    expect(checkTally([check('a', 'pass'), check('b', 'fail'), check('c', 'skip')])).toEqual({ passed: 1, failed: 1, skipped: 1, total: 3 });
  });
});

describe('stateChip', () => {
  it('names where the card is', () => {
    expect(stateChip({ status: 'testing' }, { state: 'OPEN', isDraft: false }, false).label).toBe('Testing');
    expect(stateChip({ status: 'fixing' }, { state: 'OPEN', isDraft: false }, false).label).toBe('Fixing');
    expect(stateChip({ status: 'passed' }, { state: 'OPEN', isDraft: false }, false)).toEqual({ label: 'Passed', tone: 'good' });
    expect(stateChip({ status: 'passed' }, { state: 'MERGED', isDraft: false }, false).label).toBe('Merged');
    expect(stateChip(undefined, undefined, true).label).toBe('Issue');
  });
});

describe('mergeRows', () => {
  const pull = { state: 'OPEN' as const, checks: 'passing' as const, failedChecks: [], pendingChecks: [], mergeable: 'MERGEABLE', mergeState: 'CLEAN', isDraft: false };

  it('shows a conflict as its own row, not text on the checks line', () => {
    const rows = mergeRows({ ...pull, mergeable: 'CONFLICTING', mergeState: 'DIRTY' }, 'main');
    expect(rows.map((r) => [r.key, r.tone, r.label])).toEqual([
      ['checks', 'good', 'All checks pass'],
      ['conflict', 'bad', 'Conflicts with main'],
    ]);
  });

  it('lists each failed check and a branch behind its base', () => {
    const rows = mergeRows({ ...pull, checks: 'failing', failedChecks: [{ name: 'CI / build', url: 'u' }], mergeState: 'BEHIND' }, 'main');
    expect(rows.map((r) => r.key)).toEqual(['checks', 'fail:CI / build', 'behind']);
  });

  it('has no merge blockers once merged', () => {
    expect(mergeRows({ ...pull, state: 'MERGED', mergeable: 'CONFLICTING' }, 'main').map((r) => r.key)).toEqual(['checks']);
  });
});

describe('noQaWords', () => {
  it("says an open PR wasn't sent, and never that of a merged or closed one (#513)", () => {
    expect(noQaWords({ state: 'OPEN' }).section).toBe('Not sent to QA yet.');
    expect(noQaWords(undefined).tile).toBe('not sent yet');
    for (const state of ['MERGED', 'CLOSED'] as const) {
      const w = noQaWords({ state });
      expect(Object.values(w).join(' ')).not.toMatch(/not sent|not in QA|no report yet/);
      expect(w.section).toMatch(/History/);
    }
  });
});
