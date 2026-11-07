import { describe, expect, it } from 'vitest';
import type { ObjectiveInsight } from './charterStats.ts';
import { backlogParts, backlogSplit, buildingOf, focusProgress, leadPace, memoryLimit, objectiveProgress, planBatches, previewSteps, spendLimit, taskStage, updateSteps } from './progressBars.ts';

const H = 3600_000;

describe('taskStage', () => {
  it('walks build → PR → QA → fix → merge', () => {
    expect(taskStage({ task: 'issue', status: 'working', prNumber: null })).toMatchObject({ at: 0, label: 'Build' });
    expect(taskStage({ task: 'issue', status: 'done', prNumber: 7 })).toMatchObject({ at: 1 });
    expect(taskStage({ task: 'qa', prNumber: 7, qa: { status: 'testing', round: 2 } })).toMatchObject({ at: 2, label: 'QA round 2' });
    expect(taskStage({ task: 'fix', prNumber: 7, qa: { status: 'fixing', round: 1 } })).toMatchObject({ at: 3, tone: 'neutral' });
    expect(taskStage({ task: null, prNumber: 7, qa: { status: 'passed', round: 1 } })).toMatchObject({ at: 4, tone: 'good' });
    expect(taskStage({ task: null, prNumber: 7, merged: true })).toMatchObject({ at: 5, label: 'Merged' });
  });
  it('tones a stuck or failed task, and is null without one', () => {
    expect(taskStage({ task: 'issue', status: 'error', prNumber: null })).toMatchObject({ at: 0, tone: 'bad' });
    expect(taskStage({ task: null, prNumber: 7, qa: { status: 'failed', round: 2 } })).toMatchObject({ at: 3, tone: 'warn' });
    expect(taskStage({ task: null, prNumber: 7, qa: { status: 'needs-human', round: 3 } })).toMatchObject({ at: 2, tone: 'bad' });
    expect(taskStage({ task: null, status: 'idle', prNumber: null })).toBeNull();
  });
});

describe('leadPace', () => {
  it('compares the time so far with the median', () => {
    expect(leadPace(0, H, 2 * H)).toMatchObject({ ratio: 0.5, tone: 'neutral' });
    expect(leadPace(0, 3 * H, 2 * H)?.tone).toBe('warn');
    expect(leadPace(0, 5 * H, 2 * H)?.tone).toBe('bad');
    expect(leadPace(0, H, null)).toBeNull();
    expect(leadPace(null, H, H)).toBeNull();
  });
});

describe('backlogSplit', () => {
  const now = new Date(2026, 10, 7, 12).getTime();
  const daysAgo = (d: number) => new Date(now - d * 24 * H).toISOString();
  const split = backlogSplit({
    issues: [
      { number: 1, body: '', labels: [] },
      { number: 2, body: 'Depends on #1', labels: [] },
      { number: 3, body: '', labels: ['swarm:skip'] },
      { number: 4, body: '', labels: [] },
      { number: 5, body: '', labels: [] },
      { number: 6, body: '', labels: [] },
    ],
    pulls: [
      { number: 10, state: 'OPEN', mergedAt: null, closesIssues: [4] },
      { number: 11, state: 'MERGED', mergedAt: daysAgo(0), closesIssues: [] },
      { number: 12, state: 'MERGED', mergedAt: daysAgo(2), closesIssues: [] },
      { number: 13, state: 'MERGED', mergedAt: daysAgo(9), closesIssues: [] },
    ],
    held: [{ issue: 6 }],
    building: [5],
    now,
  });
  it('sorts issues into ready, waiting and in progress', () => {
    expect(split.ready).toEqual([1]);
    expect(split.waiting).toEqual([2, 3, 6]);
    expect(split.progress).toEqual([10, 5]);
  });
  it('takes the issues being built without a PR', () => {
    const a = (issueNumber: number | null, prNumber: number | null, status = 'working', role = 'agent') => ({ role, task: 'issue' as const, status: status as 'working', issueNumber, prNumber });
    expect(buildingOf([a(5, null), a(6, 10), a(7, null, 'idle'), a(8, null, 'working', 'ceo'), a(null, null)])).toEqual([5]);
  });
  it('counts the week’s merges by day, today last', () => {
    expect(split.done).toEqual([11, 12]);
    expect(split.trend).toEqual([0, 0, 0, 0, 1, 0, 1]);
    expect(backlogParts(split).map((p) => p.value)).toEqual([2, 2, 1, 3]);
  });
});

const insight = (id: string, prs: number[], open: Partial<ObjectiveInsight['open']>): ObjectiveInsight =>
  ({ id, open: { ready: [], progress: [], waiting: [], ...open }, byWindow: { 7: { prs: [] }, 30: { prs } } }) as unknown as ObjectiveInsight;

describe('objective progress', () => {
  it('is merged against open issues', () => {
    const p = objectiveProgress(insight('O1', [1, 2, 3], { ready: [4], waiting: [5] }));
    expect(p.share).toBe(0.6);
    expect(objectiveProgress(insight('O2', [], {})).share).toBeNull();
  });
  it('adds up the focus objectives, each item once', () => {
    const all = [insight('O1', [1, 2], { ready: [4] }), insight('O2', [2], { ready: [4, 5] }), insight('O3', [9], {})];
    const f = focusProgress(all, ['O1', 'O2'])!;
    expect(f.merged).toEqual([1, 2]);
    expect(f.ready).toEqual([4, 5]);
    expect(f.share).toBe(0.5);
    expect(focusProgress(all, [])).toBeNull();
  });
});

describe('planBatches', () => {
  const ceo = '\n\n---\n_Filed by Mimoun, the cubefarm CEO._';
  const t0 = Date.parse('2026-11-01T10:00:00Z');
  const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
  it('groups the CEO’s issues filed together and counts merged ones', () => {
    const issues = [
      { number: 3, title: 'UX round 7: tabs', body: `x${ceo}`, createdAt: at(2) },
      { number: 4, title: 'UX round 7: sheets', body: `x${ceo}`, createdAt: at(4) },
      { number: 5, title: 'Human issue', body: 'by hand', createdAt: at(3) },
      { number: 9, title: 'Later: a', body: `x${ceo}`, createdAt: at(300) },
    ];
    const pulls = [
      { number: 20, state: 'MERGED', closesIssues: [1], issueCreatedAt: at(0) },
      { number: 21, state: 'OPEN', closesIssues: [4], issueCreatedAt: at(4) },
      { number: 22, state: 'MERGED', closesIssues: [7], issueCreatedAt: at(200) },
    ];
    const [b, ...rest] = planBatches(issues, pulls, new Set());
    expect(rest).toEqual([]); // the later one is a single issue
    expect(b).toMatchObject({ name: 'UX round 7', merged: [20], progress: [4], open: [3], total: 3 });
  });
});

describe('limits', () => {
  it('tones memory like the health strip', () => {
    expect(memoryLimit({ totalMb: 8000, availableMb: 2000, swapFreeMb: 0 }, 1500)).toEqual({ pct: 0.75, tone: 'warn' });
    expect(memoryLimit({ totalMb: 8000, availableMb: 1000, swapFreeMb: 0 }, 1500).tone).toBe('bad');
    expect(memoryLimit({ totalMb: 8000, availableMb: 6000, swapFreeMb: 0 }, 1500).tone).toBe('good');
  });
  it('fills today’s spend up to the average', () => {
    expect(spendLimit({ usd: 2, avg: 4 })).toEqual({ pct: 0.5, tone: 'good' });
    expect(spendLimit({ usd: 5, avg: 4 })).toEqual({ pct: 1, tone: 'warn' });
    expect(spendLimit({ usd: 7, avg: 4 })?.tone).toBe('bad');
    expect(spendLimit({ usd: 7, avg: 0 })).toBeNull();
  });
});

describe('steps', () => {
  it('follows a preview’s start', () => {
    expect(previewSteps('installing')).toMatchObject({ at: 1 });
    expect(previewSteps('running')).toMatchObject({ at: 3, tone: 'good' });
    expect(previewSteps('stopped')).toBeNull();
  });
  it('follows the office’s update', () => {
    expect(updateSteps('settling')?.at).toBe(1);
    expect(updateSteps('updating')?.at).toBe(3);
    expect(updateSteps('failed')?.tone).toBe('bad');
    expect(updateSteps('none')).toBeNull();
  });
});
