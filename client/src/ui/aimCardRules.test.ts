import { describe, expect, it } from 'vitest';
import { taskStage } from '../../../shared/progressBars';
import type { AgentView } from '../../../shared/types';
import { aimProgress, aimStatus, prLabel } from './aimCardRules';

const agent = (x: Partial<AgentView>) => ({ name: 'Alan', role: 'agent', status: 'working', task: 'issue', issueNumber: null, issueTitle: null, prNumber: null, waiting: null, ...x }) as AgentView;

describe('the compact aim card and the name tag (#406)', () => {
  it('says what they are on in one line', () => {
    const building = agent({ issueNumber: 299 });
    const stage = taskStage({ task: 'issue', status: 'working', prNumber: null, qa: null });
    expect(aimStatus(building, stage, null)).toBe('Building #299 · step 1 of 5');
    expect(aimStatus(agent({ task: 'qa', prNumber: 405 }), null, 2)).toBe('Testing PR #405 · round 2');
    expect(aimStatus(agent({ task: 'fix', prNumber: 405 }), null, 3)).toBe('Fixing PR #405 · round 3');
    expect(aimStatus(agent({ status: 'idle' }), null, null)).toBe('Free');
    expect(aimStatus(agent({ waiting: 'manager' as AgentView['waiting'] }), null, null)).toBe('Waiting for you');
  });

  it('fills the thin bar by the task stage', () => {
    expect(aimProgress(null)).toBe(0);
    expect(aimProgress(taskStage({ task: 'qa', status: 'working', prNumber: 4, qa: { status: 'testing', round: 1 } }))).toBeCloseTo(3 / 5);
  });

  it('shows their PR with QA mark, never the CEO', () => {
    expect(prLabel(agent({ prNumber: 405 }), 'passed')).toEqual({ text: 'PR #405', mark: 'passed' });
    expect(prLabel(agent({ prNumber: 405 }), 'fixing')).toEqual({ text: 'PR #405', mark: 'failed' });
    expect(prLabel(agent({ prNumber: 405 }), undefined)).toEqual({ text: 'PR #405', mark: null });
    expect(prLabel(agent({}), 'passed')).toBeNull();
    expect(prLabel(agent({ role: 'ceo', prNumber: 1 }), null)).toBeNull();
  });
});
