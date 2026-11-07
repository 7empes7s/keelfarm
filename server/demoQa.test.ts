import { describe, expect, it } from 'vitest';
import { groupChecks } from '../client/src/ui/detailsRules';
import { DEMO_QA_ISSUE, demoQaReport } from './demoQa.ts';

describe('demoQaReport', () => {
  const r = demoQaReport('demo-co/recipe-box', 9, { number: 3, title: 'Recipe page on a phone' }, 3_600_000, 'abc');

  it('has 8+ checks of every result, a charter violation and a merge conflict', () => {
    expect(r.checks.length).toBeGreaterThanOrEqual(8);
    expect(new Set(r.checks.map((c) => c.result))).toEqual(new Set(['pass', 'fail', 'skip']));
    expect(groupChecks(r.checks).charter).toHaveLength(1);
    expect(r.pull).toMatchObject({ mergeable: 'CONFLICTING', mergeState: 'DIRTY', state: 'OPEN', closesIssues: [3] });
  });

  it("closes an issue whose title wraps on a phone, since the details header shows the issue's title", () => {
    // ~22 characters fit a line of the header's title at 390px: two lines need well over that
    expect(DEMO_QA_ISSUE.title.length).toBeGreaterThan(60);
  });
});
