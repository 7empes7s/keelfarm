import { describe, expect, it } from 'vitest';
import {
  chooseIssue,
  cleanOverrides,
  effectivePractices,
  everyProjectSettings,
  floorLeases,
  floorOverrides,
  hotFiles,
  LEASE_WAIT_MS,
  overlap,
  practiceLines,
  PRACTICES_OFF,
  predictFiles,
  qaPracticeLines,
  rebaseHandOffs,
  upToDateStep,
  type Lease,
} from './practices.ts';

describe('defaults inheritance', () => {
  it('a floor inherits every project, overrides what it sets, and a variant wins over both', () => {
    const office = { ...PRACTICES_OFF, upToDate: true, diffBudget: 400 };
    expect(effectivePractices(office)).toEqual(office);
    expect(effectivePractices(office, { upToDate: false, leases: true })).toEqual({ ...office, upToDate: false, leases: true });
    expect(effectivePractices(office, { leases: true }, { leases: false, autoRebase: true })).toEqual({ ...office, leases: false, autoRebase: true });
    expect(effectivePractices(undefined)).toEqual(PRACTICES_OFF);
  });

  it('a floor switch set to null inherits again', () => {
    const f = floorOverrides({ leases: true, diffBudget: 300 }, { leases: null, autoRebase: true });
    expect(f).toEqual({ diffBudget: 300, autoRebase: true });
  });

  it('checks what it is given', () => {
    expect(cleanOverrides({ leases: true, nope: 1, generated: ['./docs/coverage.md', 'a\\b.md', '../etc/passwd'] })).toEqual({ leases: true, generated: ['docs/coverage.md', 'a/b.md'] });
    expect(() => cleanOverrides({ leases: 'yes' })).toThrow(/true or false/);
    expect(() => cleanOverrides({ diffBudget: -1 })).toThrow(/lines/);
    const e = everyProjectSettings(undefined, { practices: { upToDate: true } });
    expect(e).toEqual({ practices: { ...PRACTICES_OFF, upToDate: true } });
    expect(everyProjectSettings(e, { practices: { leases: true } })).toEqual({ practices: { ...PRACTICES_OFF, upToDate: true, leases: true } });
  });
});

describe('up to date before merge', () => {
  it('is current, needs an update, conflicts, or has to be asked', () => {
    expect(upToDateStep({ mergeable: 'MERGEABLE', mergeState: 'CLEAN' }, 0)).toBe('current');
    expect(upToDateStep({ mergeable: 'MERGEABLE', mergeState: 'CLEAN' }, 3)).toBe('update');
    expect(upToDateStep({ mergeable: 'MERGEABLE', mergeState: 'BEHIND' }, null)).toBe('update');
    expect(upToDateStep({ mergeable: 'CONFLICTING', mergeState: 'DIRTY' }, 2)).toBe('conflict');
    expect(upToDateStep({ mergeable: 'MERGEABLE', mergeState: 'CLEAN' }, null)).toBe('unknown');
  });
});

describe('file leases', () => {
  it('overlap: the same file, or a folder and a file in it', () => {
    expect(overlap(['server/swarm.ts', 'client/a.ts'], ['server/swarm.ts'])).toEqual(['server/swarm.ts']);
    expect(overlap(['server/swarm/qa.ts'], ['server/swarm/'])).toEqual(['server/swarm/qa.ts']);
    expect(overlap(['server/swarm'], ['server/swarm/qa.ts'])).toEqual(['server/swarm']);
    expect(overlap(['server/swarmy.ts'], ['server/swarm'])).toEqual([]);
  });

  it('predicts files from the issue text, resolving bare names against known paths', () => {
    const text = 'Conflicts in `Phone.tsx` and server/swarm.ts every day; see docs/ and e.g. the STATE.md log. Version 1.2.3, https://x.io/a.ts';
    expect(predictFiles(text, ['client/src/ui/Phone.tsx'])).toEqual(['client/src/ui/Phone.tsx', 'server/swarm.ts', 'docs/', 'STATE.md']);
    expect(predictFiles('Add a dark mode toggle.')).toEqual([]);
    expect(predictFiles('Touches src/App.tsx and src/styles.css.')).toEqual(['src/App.tsx', 'src/styles.css']);
  });

  it('one lease per issue: declared files win over predicted ones, PR files are added; expired work holds nothing', () => {
    const leases = floorLeases(
      [
        { agentId: 'a1', issue: 5, pr: null, declared: ['server/swarm.ts'], predicted: ['README.md'] },
        { agentId: 'a2', issue: 6, pr: 9, declared: null, predicted: ['client/x.ts'] },
        { agentId: 'a3', issue: 7, pr: null, declared: null, predicted: [] },
      ],
      [{ number: 9, issues: [6], files: ['client/y.ts'] }],
    );
    expect(leases).toEqual([
      { issue: 5, pr: null, agentId: 'a1', files: ['server/swarm.ts'], source: 'declared' },
      { issue: 6, pr: 9, agentId: 'a2', files: ['client/x.ts', 'client/y.ts'], source: 'pr' },
    ]);
    // The agent stopped and the PR merged: neither is listed any more, so no lease is left.
    expect(floorLeases([], [])).toEqual([]);
  });

  const leases: Lease[] = [{ issue: 1, pr: 10, agentId: null, files: ['client/src/ui/Phone.tsx'], source: 'pr' }];
  const ready = [
    { number: 2, files: ['Phone.tsx'], on: true },
    { number: 3, files: ['server/ceo.ts'], on: true },
  ];

  it('the scheduler prefers non-overlapping issues', () => {
    const r = chooseIssue(ready, leases, { now: 1000, heldSince: new Map() });
    expect(r.pick).toBe(3);
    expect(r.held).toEqual([{ issue: 2, by: { issue: 1, pr: 10 }, files: ['Phone.tsx'], since: 1000 }]);
  });

  it('a lease-blocked issue starts after LEASE_WAIT_MS anyway', () => {
    const only = [ready[0]];
    expect(chooseIssue(only, leases, { now: 1000, heldSince: new Map() }).pick).toBeNull();
    expect(chooseIssue(only, leases, { now: 1000 + LEASE_WAIT_MS - 1, heldSince: new Map([[2, 1000]]) }).pick).toBeNull();
    expect(chooseIssue(only, leases, { now: 1000 + LEASE_WAIT_MS, heldSince: new Map([[2, 1000]]) })).toEqual({ pick: 2, held: [] });
  });

  it('an issue never waits on its own lease', () => {
    expect(chooseIssue([{ number: 1, files: ['client/src/ui/Phone.tsx'], on: true }], leases, { now: 0, heldSince: new Map() }).pick).toBe(1);
  });

  it('an issue with leases off (its floor or variant) is never held back', () => {
    expect(chooseIssue([{ ...ready[0], on: false }, ready[1]], leases, { now: 0, heldSince: new Map() })).toEqual({ pick: 2, held: [] });
  });
});

describe('hot files', () => {
  it('ranks files by conflict fixes, then by churn', () => {
    const log = [
      { subject: "Merge branch 'main' into swarm/issue-3-ana", files: ['STATE.md', 'src/i18n/en.json'] },
      { subject: 'Resolve conflicts with main', files: ['STATE.md'] },
      { subject: 'Add login', files: ['src/login.ts', 'STATE.md'] },
      { subject: 'Fix login', files: ['src/login.ts'] },
      { subject: 'Polish login', files: ['src/login.ts'] },
      { subject: 'More login', files: ['src/login.ts'] },
      { subject: 'Once', files: ['README.md'] },
    ];
    expect(hotFiles(log)).toEqual([
      { path: 'STATE.md', score: 7, conflicts: 2 },
      { path: 'src/login.ts', score: 4, conflicts: 0 },
    ]);
  });
});

describe('auto-rebase', () => {
  const pulls = [
    { number: 1, state: 'OPEN', headRefName: 'swarm/issue-1-a', mergeable: 'CONFLICTING', mergeState: 'DIRTY' },
    { number: 2, state: 'OPEN', headRefName: 'swarm/issue-2-b', mergeable: 'MERGEABLE', mergeState: 'CLEAN' },
    { number: 3, state: 'OPEN', headRefName: 'people/own', mergeable: 'CONFLICTING', mergeState: 'DIRTY' },
    { number: 4, state: 'OPEN', headRefName: 'swarm/issue-4-c', mergeable: 'CONFLICTING', mergeState: 'DIRTY' },
  ];
  const records = [
    { prNumber: 1, status: 'queued' },
    { prNumber: 2, status: 'queued' },
    { prNumber: 3, status: 'queued' },
    { prNumber: 4, status: 'testing' },
  ];
  it('hands conflicting swarm PRs waiting for QA or merge to a developer', () => {
    expect(rebaseHandOffs(pulls, records, true)).toEqual([1]);
    expect(rebaseHandOffs(pulls, [{ prNumber: 4, status: 'passed' }], true)).toEqual([4]);
  });
});

describe('with every switch off', () => {
  it('nothing changes: no hand-offs, no prompt lines, the first ready issue', () => {
    const pulls = [{ number: 1, state: 'OPEN', headRefName: 'swarm/issue-1-a', mergeable: 'CONFLICTING', mergeState: 'DIRTY' }];
    expect(rebaseHandOffs(pulls, [{ prNumber: 1, status: 'queued' }], PRACTICES_OFF.autoRebase)).toEqual([]);
    expect(practiceLines(PRACTICES_OFF, { base: 'main', declareTool: true })).toEqual([]);
    expect(qaPracticeLines(PRACTICES_OFF)).toEqual([]);
    const leases: Lease[] = [{ issue: 1, pr: null, agentId: 'a', files: ['a.ts'], source: 'declared' }];
    const on = PRACTICES_OFF.leases;
    expect(chooseIssue([{ number: 2, files: ['a.ts'], on }, { number: 3, files: [], on }], leases, { now: 0, heldSince: new Map() })).toEqual({ pick: 2, held: [] });
  });

  it('each switch adds its line', () => {
    const lines = practiceLines({ ...PRACTICES_OFF, leases: true, generated: ['docs/coverage.md'], appendOnly: ['STATE.md'], diffBudget: 400 }, { base: 'main', declareTool: true });
    expect(lines).toHaveLength(4);
    expect(lines.join('\n')).toMatch(/declare_files[\s\S]*docs\/coverage\.md[\s\S]*STATE\.md[\s\S]*400 lines/);
    expect(practiceLines({ ...PRACTICES_OFF, leases: true }, { base: 'main', declareTool: false })).toEqual([]);
  });
});
