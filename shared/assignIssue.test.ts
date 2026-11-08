import { describe, expect, it } from 'vitest';
import { assignOrder, NEXT_FREE, planAssign, type AssignCandidate } from './assignIssue';

const ada: AssignCandidate = { id: 'a1', name: 'Ada', free: false, startedAt: 200 };
const bo: AssignCandidate = { id: 'b2', name: 'Bo', free: true, startedAt: null };
const cy: AssignCandidate = { id: 'c3', name: 'Cy', free: false, startedAt: 100 };

describe('planAssign (#265)', () => {
  it('starts the issue now for a free agent', () => {
    expect(planAssign([ada, bo], 7, 'Bo')).toEqual({ agentId: 'b2', start: true, replaces: null });
    expect(planAssign([ada, bo], 7, 'b2')).toEqual({ agentId: 'b2', start: true, replaces: null });
  });

  it("queues it as a busy agent's next task, saying which one it replaces", () => {
    expect(planAssign([ada, bo], 7, 'ada')).toEqual({ agentId: 'a1', start: false, replaces: null });
    expect(planAssign([{ ...ada, nextIssue: 3 }], 7, 'Ada')).toEqual({ agentId: 'a1', start: false, replaces: 3 });
    expect(planAssign([{ ...ada, nextIssue: 7 }], 7, 'Ada').replaces).toBeNull(); // the same one again
  });

  it('"next free": the first free agent, else the busy one who started first without a next task', () => {
    expect(planAssign([ada, bo, cy], 7, NEXT_FREE).agentId).toBe('b2');
    expect(planAssign([ada, cy], 7, '')).toEqual({ agentId: 'c3', start: false, replaces: null });
    expect(planAssign([ada, { ...cy, nextIssue: 4 }], 7, NEXT_FREE).agentId).toBe('a1');
  });

  it('refuses with what to do instead', () => {
    expect(() => planAssign([ada, bo], 7, 'Bo', 'Cy')).toThrow('Cy is already working on #7.');
    expect(() => planAssign([], 7, NEXT_FREE)).toThrow(/no agents: add one/);
    expect(() => planAssign([ada, bo], 7, 'Zed')).toThrow('No agent "Zed" on this floor. Agents here: Ada, Bo, or "next free".');
    expect(() => planAssign([{ ...ada, nextIssue: 3 }], 7, NEXT_FREE)).toThrow(/name an agent to replace theirs \(Ada: #3\)/);
  });
});

describe('assignOrder', () => {
  it('lists free agents first, then busy ones who started first', () => {
    expect(assignOrder([ada, bo, cy]).map((a) => a.name)).toEqual(['Bo', 'Cy', 'Ada']);
  });
});
