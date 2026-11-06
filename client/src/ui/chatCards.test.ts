import { describe, expect, it } from 'vitest';
import { actionStatus, continuesGroup, daySeparator, elapsed, matchCommands, slashItems, starterChips, workingLine } from './chatCards';
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
    expect(workingLine({ label: 'Replying' }, { label: 'Filing an issue', state: 'running' }, [{ label: 'Review' }])).toEqual({ now: 'Filing an issue', next: 'Review' });
    expect(workingLine({ label: 'Replying' }, { label: 'Filing #4', state: 'done' }, [])).toEqual({ now: 'Replying', next: null });
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
