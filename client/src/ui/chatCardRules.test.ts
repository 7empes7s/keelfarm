import { describe, expect, it } from 'vitest';
import { actionStatus, continuesGroup, daySeparator, elapsed, matchCommands, replyLog, rowLog, slashItems, starterChips, stepsSummary, stepTime, workingLine } from './chatCardRules';
import type { RefWorld } from './chatRefs';
import type { PullInfo } from '../../../shared/types';

const pull = (o: Partial<PullInfo>) => ({ number: 20, state: 'OPEN', closesIssues: [104], ...o }) as PullInfo;
const world = (o: { pulls?: PullInfo[]; issues?: number[]; agents?: RefWorld['agents']; qa?: RefWorld['qa'] } = {}): RefWorld => ({
  repos: [{ id: 'acme/shop', floor: 3, fullName: 'acme/shop', pulls: o.pulls ?? [], issues: (o.issues ?? []).map((number) => ({ number }) as never), preview: {} as never }],
  agents: o.agents ?? {},
  qa: o.qa ?? {},
});
const grace = (o: object) => ({ grace: { id: 'grace', name: 'Grace', repoId: 'acme/shop', status: 'working', issueNumber: null, prNumber: null, ...o } }) as RefWorld['agents'];
const issue = { kind: 'issue', repoId: 'acme/shop', number: 104 } as const;

describe("an action card's live status (#108)", () => {
  it('follows a filed issue from queued to building, QA and merged', () => {
    expect(actionStatus(issue, world({ issues: [104] }))).toEqual({ label: 'queued' });
    expect(actionStatus(issue, world({ issues: [104], agents: grace({ issueNumber: 104 }) }))).toEqual({ label: 'building by Grace', tone: 'good' });
    expect(actionStatus(issue, world({ issues: [104], pulls: [pull({})] }))).toEqual({ label: 'PR #20 open', tone: 'warn' });
    expect(actionStatus(issue, world({ issues: [104], pulls: [pull({})], qa: { 'acme/shop#20': { status: 'testing', commentUrl: null } } }))?.label).toBe('in QA');
    expect(actionStatus(issue, world({ pulls: [pull({})], qa: { 'acme/shop#20': { status: 'fixing', commentUrl: null } }, agents: grace({ prNumber: 20 }) }))?.label).toBe('fixing by Grace');
    expect(actionStatus(issue, world({ pulls: [pull({})], qa: { 'acme/shop#20': { status: 'passed', commentUrl: null } } }))).toEqual({ label: 'QA passed', tone: 'good' });
    expect(actionStatus(issue, world({ pulls: [pull({ state: 'CLOSED' }), pull({ number: 21, state: 'MERGED' })] }))).toEqual({ label: 'merged', tone: 'good', merged: true });
    expect(actionStatus(issue, world())).toEqual({ label: 'closed' });
  });

  it('shows a floor\'s team and an agent\'s status; null once gone', () => {
    expect(actionStatus({ kind: 'floor', repoId: 'acme/shop' }, world({ agents: grace({}) }))).toEqual({ label: '1 agent · 1 busy' });
    expect(actionStatus({ kind: 'agent', agentId: 'grace' }, world({ agents: grace({ issueNumber: 7 }) }))).toEqual({ label: 'working · #7', tone: 'good' });
    expect(actionStatus({ kind: 'agent', agentId: 'ada' }, world())).toBeNull();
    expect(actionStatus({ kind: 'floor', repoId: 'gone/repo' }, world())).toBeNull();
  });
});

describe('the working strip', () => {
  it('says the running step, else the job, and the next job', () => {
    expect(workingLine(null, null, [])).toBeNull();
    expect(workingLine({ label: 'Replying' }, { label: 'Filing an issue', icon: '📝', state: 'running', at: 1 }, [{ label: 'Review' }])).toEqual({ now: 'Filing an issue', icon: '📝', next: 'Review' });
    expect(workingLine({ label: 'Replying' }, { label: 'Filed #4', icon: '📝', state: 'done', at: 1 }, [])).toEqual({ now: 'Replying', icon: null, next: null });
  });

  it("times a step: how long it took, or has been running", () => {
    expect(stepTime({ label: 'x', icon: '•', state: 'done', at: 1, ms: 42_000 }, 0)).toBe('42 s');
    expect(stepTime({ label: 'x', icon: '•', state: 'running', at: 1_000 }, 4_000)).toBe('3.0 s');
    expect(stepTime({ label: 'x', icon: '•', state: 'done', at: 0 }, 9)).toBe('');
  });

  it('counts time plainly', () => {
    expect([elapsed(4_200), elapsed(185_000), elapsed(3_720_000), elapsed(-5)]).toEqual(['4s', '3m 05s', '1h 02m', '0s']);
  });
});

describe('starters and "/" commands', () => {
  it('fit the office: no floors, an empty backlog, a charter to draft or review, busy agents', () => {
    expect(starterChips({ floors: [], busy: 0 })[0]).toBe('Help me add my first project');
    const floors = [
      { floor: 1, issues: 3, objectives: 2, proposal: false },
      { floor: 2, issues: 0, objectives: 0, proposal: false },
    ];
    expect(starterChips({ floors, busy: 2 })).toEqual(['Plan the next milestone for floor 2', "What's everyone working on?", 'Draft a charter for floor 2', 'Where did the money go this week?']);
    expect(starterChips({ floors: [{ ...floors[0], proposal: true }], busy: 0 })).toContain('Review the charter proposal for floor 1');
    expect(starterChips({ floors: [floors[0]], busy: 0 })).toContain('Review the charter for floor 1');
  });

  it('match by name, commands before skills, templates for the floor', () => {
    expect(matchCommands('').map((c) => c.cmd)).toEqual(['plan', 'status', 'charter', 'objective', 'research', 'mandate', 'team', 'experiment', 'costs']);
    expect(matchCommands('t')[0].cmd).toBe('team'); // starts with it first
    const items = slashItems({ skills: ['planner'], apps: [] }, 'plan', 2);
    expect(items.map((x) => x.name)).toEqual(['/plan', 'planner']);
    expect(items[0].text).toBe('Plan the next milestone for floor 2: ');
    expect(slashItems(null, 'research', 1)[0].text).toBe('Research: ');
  });
});

describe("the thread's days and groups", () => {
  const now = new Date(2026, 10, 6, 15).getTime();
  it('puts a separator above each new day', () => {
    expect(daySeparator(undefined, now, now)).toBe('Today');
    expect(daySeparator(now - 60_000, now, now)).toBeNull();
    expect(daySeparator(undefined, now - 86_400_000, now)).toBe('Yesterday');
    expect(daySeparator(undefined, now - 5 * 86_400_000, now)).toMatch(/1|Nov/);
  });

  it('groups messages from the same sender a few minutes apart', () => {
    expect(continuesGroup({ from: 'ceo', at: now }, { from: 'ceo', at: now + 60_000 })).toBe(true);
    expect(continuesGroup({ from: 'ceo', at: now }, { from: 'manager', at: now + 60_000 })).toBe(false);
    expect(continuesGroup({ from: 'ceo', at: now }, { from: 'ceo', at: now + 10 * 60_000 })).toBe(false);
    expect(continuesGroup({ from: 'office', at: now }, { from: 'office', at: now })).toBe(false);
    expect(continuesGroup(undefined, { from: 'ceo', at: now })).toBe(false);
  });
});

describe("a reply's steps row (#150)", () => {
  const log = { steps: [{ label: 'Checking the floors', icon: '🏢', state: 'done' as const, at: 1, ms: 900 }], count: 6, ms: 42_000 };

  it('sums the round up in one line', () => {
    expect(stepsSummary(log, 1)).toBe('6 steps · 1 action · 42 s');
    expect(stepsSummary({ ...log, count: 1, ms: 0 }, 0)).toBe('1 step');
  });

  it("keeps an older reply's count and time after a reload stripped its steps, never '0 steps' (#378)", () => {
    const stripped = { steps: [], count: 4, ms: 7944 };
    expect(stepsSummary(rowLog({ log: stripped }), 0)).toBe('4 steps · 7.9 s');
    expect(rowLog({ log })).toBe(log);
    expect(stepsSummary(rowLog({}), 0)).toBe('Summary');
    expect(stepsSummary(rowLog({}), 2)).toBe('Summary · 2 actions');
  });

  it("reads a reply's own log, else the labels an older reply kept, a failed one marked", () => {
    expect(replyLog({ log })).toBe(log);
    expect(replyLog({ steps: ['Reading company status', '✗ Searching the web'] })).toEqual({
      steps: [
        { label: 'Reading company status', icon: '•', state: 'done', at: 0 },
        { label: 'Searching the web', icon: '•', state: 'failed', at: 0 },
      ],
      count: 2,
      ms: 0,
    });
    expect(replyLog({})).toBeNull();
  });
});
