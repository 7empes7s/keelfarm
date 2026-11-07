import { describe, expect, it } from 'vitest';
import { costInsights, kindShares, perMergeTrend, spendVsAverage, topFloor, wasteCause, wasteGroups, type CostDayRow, type CostsView, type CostSplit, type CostWaste } from './costs.ts';
import { roundsView } from './rounds.ts';

const split = (o: Partial<CostSplit> = {}): CostSplit => ({ usd: 0, sessions: 0, merges: 0, perMerge: null, wasteUsd: 0, wasteSessions: 0, byKind: {}, ...o });
const day = (d: string, o: Partial<CostSplit> = {}): CostDayRow => ({ day: d, ...split(o) });
const waste = (o: Partial<CostWaste> = {}): CostWaste => ({
  at: 0,
  repoId: 'acme/shop',
  agent: 'Ada',
  kind: 'issue',
  issue: 7,
  pr: null,
  usd: 1,
  why: 'ended without a PR',
  cause: 'Build ended without a PR',
  streak: 1,
  ...o,
});
const view = (o: Partial<CostsView> = {}): CostsView => ({ days: 7, since: 0, total: split(), floors: [], byDay: [], top: [], waste: [], kinds: [], startup: [], rounds: roundsView([], 0, 0), ...o });

describe('wasteCause', () => {
  it('names the cause by the kind of task and why', () => {
    expect(wasteCause('issue', 'ended without a PR')).toBe('Build ended without a PR');
    expect(wasteCause('fix-qa', 'ended without a commit')).toBe('Fix ended without a commit');
    expect(wasteCause('ceo-review', 'a review that changed nothing')).toBe('CEO review that changed nothing');
    expect(wasteCause('qa', 'QA round 3')).toBe(wasteCause('qa', 'QA round 4'));
  });
});

describe('wasteGroups', () => {
  it('groups by cause, costliest first, with counts and shares', () => {
    const groups = wasteGroups([waste({ usd: 1 }), waste({ kind: 'fix-qa', cause: 'Fix ended without a commit', usd: 3 }), waste({ issue: 8, usd: 1 })]);
    expect(groups.map((g) => [g.cause, g.usd, g.count, g.share])).toEqual([
      ['Fix ended without a commit', 3, 1, 0.6],
      ['Build ended without a PR', 2, 2, 0.4],
    ]);
  });

  it('puts one piece of work wasted in a row into one run, even with others in between', () => {
    const [g] = wasteGroups([waste({ streak: 3, usd: 1 }), waste({ issue: 9 }), waste({ streak: 2, usd: 2 }), waste({ streak: 1, usd: 0.5 }), waste({ streak: 1, at: -1 })]);
    expect(g.runs.map((r) => [r.items[0].issue, r.items.length, r.usd])).toEqual([
      [7, 3, 3.5],
      [9, 1, 1],
      [7, 1, 1],
    ]);
  });
});

describe('spendVsAverage', () => {
  it('compares today with the daily average of the days before it', () => {
    const byDay = [day('2026-11-06', { usd: 12 }), day('2026-11-05', { usd: 6 }), day('2026-11-01', { usd: 30 })];
    expect(spendVsAverage({ byDay, days: 7 }, '2026-11-06')).toEqual({ usd: 12, avg: 6, change: 1 });
  });

  it('counts at most 7 days back, across a month', () => {
    const byDay = [day('2026-12-01', { usd: 1 }), day('2026-11-30', { usd: 7 }), day('2026-11-23', { usd: 100 })];
    expect(spendVsAverage({ byDay, days: 30 }, '2026-12-01')).toEqual({ usd: 1, avg: 1, change: 0 });
  });

  it('has nothing to compare in a one-day view, or without earlier spend', () => {
    expect(spendVsAverage({ byDay: [day('2026-11-06', { usd: 3 })], days: 1 }, '2026-11-06')).toBeNull();
    expect(spendVsAverage({ byDay: [day('2026-11-06', { usd: 3 })], days: 7 }, '2026-11-06')).toEqual({ usd: 3, avg: 0, change: null });
  });
});

describe('perMergeTrend', () => {
  it('runs oldest first and compares the newer half with the older', () => {
    const t = perMergeTrend([day('2026-11-06', { perMerge: 2 }), day('2026-11-05', { perMerge: null }), day('2026-11-04', { perMerge: 4 }), day('2026-11-03', { perMerge: 4 })]);
    expect(t.points).toEqual([4, 4, null, 2]);
    expect(t.change).toBeCloseTo(-0.25);
  });

  it('has no trend with fewer than two days of merges', () => {
    expect(perMergeTrend([day('2026-11-06', { perMerge: 2 })]).change).toBeNull();
  });
});

describe('kindShares', () => {
  it('folds task kinds into build, QA, fix and CEO', () => {
    expect(kindShares({ issue: 4, qa: 2, 'fix-qa': 1, 'fix-checks': 1, 'ceo-chat': 1.5, consult: 0.5 })).toEqual([
      { group: 'build', usd: 4, share: 0.4 },
      { group: 'qa', usd: 2, share: 0.2 },
      { group: 'fix', usd: 2, share: 0.2 },
      { group: 'ceo', usd: 2, share: 0.2 },
    ]);
    expect(kindShares({ qa: 1 })).toEqual([{ group: 'qa', usd: 1, share: 1 }]);
  });
});

describe('topFloor', () => {
  it('is the costliest floor, never the CEO', () => {
    const floors = [
      { repoId: '', ...split({ usd: 9 }) },
      { repoId: 'acme/api', ...split({ usd: 2 }) },
      { repoId: 'acme/shop', ...split({ usd: 4 }) },
    ];
    expect(topFloor({ floors, total: split({ usd: 15 }) })).toMatchObject({ repoId: 'acme/shop', usd: 4 });
    expect(topFloor({ floors: floors.slice(0, 1), total: split({ usd: 9 }) })).toBeNull();
  });
});

describe('costInsights', () => {
  it('has the waste share of spend and the biggest waste cause', () => {
    const v = view({ total: split({ usd: 20, wasteUsd: 5, byKind: { issue: 20 } }), waste: [waste({ usd: 2 }), waste({ kind: 'qa', cause: 'QA past round 2', usd: 3 })] });
    const i = costInsights(v, '2026-11-06');
    expect(i.wasteShare).toBe(0.25);
    expect(i.biggestCause).toEqual({ cause: 'QA past round 2', usd: 3 });
    expect(costInsights(view(), '2026-11-06')).toMatchObject({ wasteShare: null, biggestCause: null, topFloor: null, kinds: [] });
  });
});
