import { describe, expect, it } from 'vitest';
import { canPickWork, ringStatus, sheetAfterDrag, taskLine, taskSteps } from './agentWindow';

const agent = { status: 'working' as const, task: 'issue' as const, waiting: null, blocked: null, issueNumber: 1059, issueTitle: 'Access package assignment policy', prNumber: null };

describe('the agent window (#117)', () => {
  it('rings the avatar by what they do, with an icon and a label', () => {
    expect(ringStatus(agent)).toEqual({ ring: 'working', icon: '●', label: 'Working' });
    expect(ringStatus({ ...agent, task: 'qa' }).ring).toBe('qa');
    expect(ringStatus({ ...agent, task: 'fix' }).ring).toBe('fixing');
    expect(ringStatus({ ...agent, status: 'error' })).toMatchObject({ ring: 'error', label: 'Needs help' });
    expect(ringStatus({ ...agent, blocked: 'a prompt' })).toMatchObject({ ring: 'error', label: 'Blocked' });
    expect(ringStatus({ ...agent, status: 'done', waiting: 'manager' })).toMatchObject({ ring: 'waiting', label: 'Waiting for you' });
    expect(ringStatus({ ...agent, status: 'idle', task: null })).toMatchObject({ ring: 'idle', label: 'Free' });
  });

  it('offers work whenever they are not working, not only when free', () => {
    for (const status of ['idle', 'done', 'stopped', 'error'] as const) expect(canPickWork({ status })).toBe(true);
    for (const status of ['working', 'preparing'] as const) expect(canPickWork({ status })).toBe(false);
  });

  it('says the task in one line', () => {
    expect(taskLine(agent)).toBe('Building #1059 · Access package assignment policy');
    expect(taskLine({ ...agent, task: 'qa', prNumber: 12 })).toBe('Testing PR #12 · Access package assignment policy');
    expect(taskLine({ ...agent, task: 'fix', prNumber: 12, issueTitle: null })).toBe('Fixing PR #12');
    expect(taskLine({ ...agent, status: 'idle' })).toBe('Free · pick work in Details');
  });

  it("lays out this task's steps, the current one marked", () => {
    const states = (s: ReturnType<typeof taskSteps>) => s.map((x) => `${x.label}:${x.state}`);
    expect(states(taskSteps(agent, undefined))).toEqual(['Build:now', 'PR:next', 'QA round 1:next']);
    expect(states(taskSteps({ ...agent, status: 'done', prNumber: 7 }, { status: 'testing', round: 1 }))).toEqual(['Build:done', 'PR #7:done', 'QA round 1:now']);
    expect(states(taskSteps({ ...agent, status: 'done', prNumber: 7 }, { status: 'failed', round: 2 }))).toEqual(['Build:done', 'PR #7:done', 'QA round 2:done', 'Fix:next']);
    expect(states(taskSteps({ ...agent, task: 'fix', prNumber: 7 }, { status: 'fixing', round: 2 }))).toEqual(['Build:done', 'PR #7:done', 'QA round 2:done', 'Fix:now', 'QA round 3:next']);
    expect(states(taskSteps({ ...agent, status: 'done', prNumber: 7 }, { status: 'passed', round: 1 }))).toEqual(['Build:done', 'PR #7:done', 'QA round 1:done', 'Merge:next']);
    expect(taskSteps({ ...agent, status: 'idle' }, undefined)).toEqual([]);
  });

  it('opens the sheet on a swipe up, closes it on a swipe down, and toggles on a tap', () => {
    expect(sheetAfterDrag(false, -80)).toBe(true);
    expect(sheetAfterDrag(true, -80)).toBe(true);
    expect(sheetAfterDrag(true, 80)).toBe(false);
    expect(sheetAfterDrag(false, 5)).toBe(true);
    expect(sheetAfterDrag(true, -5)).toBe(false);
  });
});
