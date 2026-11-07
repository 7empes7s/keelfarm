import { describe, expect, it } from 'vitest';
import { groupChecks } from '../client/src/ui/detailsRules';
import { demoQaReport } from './demoQa.ts';

describe('demoQaReport', () => {
  const r = demoQaReport('demo-co/recipe-box', 9, { number: 3, title: 'Recipe page on a phone' }, 3_600_000, 'abc');

  it('has 8+ checks of every result, a charter violation and a merge conflict', () => {
    expect(r.checks.length).toBeGreaterThanOrEqual(8);
    expect(new Set(r.checks.map((c) => c.result))).toEqual(new Set(['pass', 'fail', 'skip']));
    expect(groupChecks(r.checks).charter).toHaveLength(1);
    expect(r.pull).toMatchObject({ mergeable: 'CONFLICTING', mergeState: 'DIRTY', state: 'OPEN', closesIssues: [3] });
  });
});
