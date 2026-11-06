import { describe, expect, it } from 'vitest';
import { cleanCharter, emptyLog, type ObjectiveLog } from './charter.ts';
import { charterInsights, citedRule, focusIds, STALLED_MS, type InsightInput } from './charterStats.ts';
import type { CostRecord, CostSession, SessionOutcome } from './costs.ts';

const now = Date.parse('2026-11-05T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => now - days * DAY;

const charter = cleanCharter({
  objectives: [
    { id: 'O1', outcome: 'Capture in one tap' },
    { id: 'O2', outcome: 'Plan the week' },
    { id: 'O3', outcome: 'Never lose a todo' },
  ],
  standards: ['Nothing overflows at 375px', 'New logic comes with tests'],
  nonGoals: ['Accounts or sync'],
  focus: 'O2, o3: planning',
});

const session = (s: Partial<CostSession> & { at: number }): CostRecord => ({ type: 'session', ms: DAY / 2, repoId: 'r', agentId: 'a', agent: 'Ada', kind: 'issue', issue: null, pr: null, round: null, model: 'm', effort: 'medium', usd: 1, tokens: null, outcome: 'pr', ...s });
const qa = (pr: number, round: number, outcome: SessionOutcome, at: number) => session({ kind: 'qa', pr, round, outcome, at, usd: 0.5 });

/** O1: PR 10 (issue 1, 2 days ago, passed QA at once) and PR 11 (issue 2, 20 days ago, two rounds); O2: PR 12 (5 days ago); untagged PR 13. */
function world(o: Partial<InsightInput> = {}): InsightInput {
  const log: ObjectiveLog = {
    ...emptyLog(),
    tags: { '1': 'O1', '2': 'O1', '3': 'O2' },
    merged: [
      { pr: 10, title: '', at: ago(2), objective: 'O1' },
      { pr: 12, title: '', at: ago(5), objective: 'O2' },
      { pr: 13, title: '', at: ago(6), objective: null },
      { pr: 11, title: '', at: ago(20), objective: 'O1' },
    ],
  };
  const ledger: CostRecord[] = [
    session({ issue: 1, pr: 10, at: ago(3), usd: 4 }), // started 3.5 days ago → merged 2 days ago: 1.5 days
    qa(10, 1, 'qa-pass', ago(2.5)),
    { type: 'merge', at: ago(2), repoId: 'r', pr: 10, issues: [1] },
    session({ issue: 2, pr: 11, at: ago(22), usd: 2 }), // 2.5 days
    qa(11, 1, 'qa-fail', ago(21.5)),
    qa(11, 2, 'qa-pass', ago(21)),
    { type: 'merge', at: ago(20), repoId: 'r', pr: 11, issues: [2] },
    session({ issue: 3, pr: 12, at: ago(5.2), usd: 3 }),
    { type: 'merge', at: ago(5), repoId: 'r', pr: 12, issues: [3] },
  ];
  return {
    log,
    charter,
    status: {},
    ledger,
    issues: [
      { number: 20, body: 'Objective: O1', labels: [] },
      { number: 21, body: 'Objective: O1\nDepends on #22', labels: [] },
      { number: 22, body: 'Objective: O1', labels: [] },
      { number: 23, body: 'Objective: O1', labels: ['swarm:skip'] },
      { number: 24, body: 'no objective', labels: [] },
    ],
    busy: new Set([22]),
    held: new Set(),
    now,
    ...o,
  };
}

const o1 = (i = charterInsights(world())) => i.objectives.find((x) => x.id === 'O1')!;

describe("an objective card's numbers", () => {
  it('counts the merges that named it and their share of all merges, in 7 and 30 days', () => {
    expect(o1().byWindow[7]).toMatchObject({ prs: [10], share: 1 / 3 });
    expect(o1().byWindow[30]).toMatchObject({ prs: [10, 11], share: 2 / 4 });
  });

  it('splits its open issues into ready, in progress and waiting', () => {
    expect(o1().open).toEqual({ ready: [20], progress: [22], waiting: [21, 23] });
  });

  it("gives QA's first-round pass rate and rounds per merge for its PRs", () => {
    expect(o1().byWindow[7]).toMatchObject({ qaPrs: [10], firstPass: 1, rounds: 1 });
    expect(o1().byWindow[30]).toMatchObject({ qaPrs: [10, 11], firstPass: 0.5, rounds: 1.5 });
    const o2 = charterInsights(world()).objectives[1];
    expect(o2.byWindow[7]).toMatchObject({ qaPrs: [], firstPass: null, rounds: null }); // no QA on record
  });

  it('adds up what its sessions cost, and the cost per merge', () => {
    expect(o1().byWindow[7]).toMatchObject({ usd: 4.5, perMerge: 4.5 });
    expect(o1().byWindow[30]).toMatchObject({ usd: 7.5, perMerge: 3.75 });
  });

  it('gives the median lead time from the first session on the issue to the merge', () => {
    expect(o1().byWindow[7].leadMs).toBe(1.5 * DAY);
    expect(o1().byWindow[30]).toMatchObject({ leadMs: 2 * DAY, leadPrs: [10, 11] });
  });

  it('draws merges per week over the last 4 weeks, oldest first', () => {
    expect(o1().weeks).toEqual([0, 1, 0, 1]);
  });

  it('carries the status the manager set', () => {
    expect(o1(charterInsights(world({ status: { O1: 'at-risk' } }))).status).toBe('at-risk');
    expect(o1().status).toBeNull();
  });
});

describe('stalled objectives', () => {
  it('are those without a merge in 14 days, unless met', () => {
    const i = charterInsights(world());
    expect(i.objectives.map((o) => o.stalled)).toEqual([false, false, true]); // O3 never merged
    const later = charterInsights(world({ now: ago(2) + STALLED_MS + 1 }));
    expect(later.objectives[0].stalled).toBe(true);
    expect(charterInsights(world({ status: { O3: 'met' } })).objectives[2].stalled).toBe(false);
  });
});

describe("the floor's insight strip", () => {
  it("gives the share of merges that served the focus's objectives", () => {
    expect(focusIds(charter)).toEqual(['O2', 'O3']);
    expect(charterInsights(world()).byWindow[7].inFocus).toEqual({ share: 1 / 3, prs: [12] });
    expect(charterInsights(world({ charter: { ...charter, focus: 'polish' } })).byWindow[7].inFocus.share).toBeNull();
  });

  it('lists merges and open issues that named no objective', () => {
    const i = charterInsights(world());
    expect(i.byWindow[7].untagged).toEqual([13]);
    expect(i.untaggedIssues).toEqual([24]);
  });

  it('counts QA failures per standard, most broken first, and non-goals touched; no data before any check', () => {
    expect(charterInsights(world()).byWindow[7].standards).toBeNull();
    const log = world().log;
    log.checks = [
      { at: ago(1), pr: 30, kind: 'standard', rule: 'New logic comes with tests' },
      { at: ago(1), pr: 31, kind: 'standard', rule: 'New logic comes with tests' },
      { at: ago(2), pr: 32, kind: 'nonGoal', rule: 'Accounts or sync' },
      { at: ago(3), pr: 10, kind: 'ok', rule: '' },
      { at: ago(10), pr: 33, kind: 'standard', rule: 'Nothing overflows at 375px' },
    ];
    const i = charterInsights(world({ log }));
    expect(i.byWindow[7].standards).toEqual([
      { rule: 'New logic comes with tests', prs: [30, 31] },
      { rule: 'Nothing overflows at 375px', prs: [] },
    ]);
    expect(i.byWindow[30].standards?.map((s) => s.prs.length)).toEqual([2, 1]);
    expect(i.byWindow[7].offCharter).toEqual([{ rule: 'Accounts or sync', prs: [32] }]);
  });
});

describe("QA's charter check", () => {
  it('names the standard broken or the non-goal touched, by its words', () => {
    expect(citedRule('ok: keeps every standard', charter)).toEqual({ kind: 'ok', rule: '' });
    expect(citedRule('violation: the toolbar overflows at 375px', charter)).toEqual({ kind: 'standard', rule: 'Nothing overflows at 375px' });
    expect(citedRule('Violation: "New logic comes with tests" (none added)', charter)).toEqual({ kind: 'standard', rule: 'New logic comes with tests' });
    expect(citedRule('violation: adds accounts and cloud sync', charter)).toEqual({ kind: 'nonGoal', rule: 'Accounts or sync' });
    expect(citedRule('violation: something else entirely', charter)).toEqual({ kind: 'standard', rule: '' });
  });
});
