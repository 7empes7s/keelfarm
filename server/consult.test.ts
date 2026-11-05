import { describe, expect, it } from 'vitest';
import { CONSULT_ANSWER_MAX, consultAnswer, consultPrompt, consultRefusal, nextConsult, type Consult } from './consult.ts';

const consult = (o: Partial<Consult>): Consult => ({ id: 'c', repoId: 'r1', floor: 1, agentId: null, question: 'How?', hint: null, at: 0, runningOn: null, ...o });

describe('nextConsult', () => {
  it('gives a consult to a free agent on its floor, oldest first', () => {
    const q = [consult({ id: 'late', at: 5 }), consult({ id: 'early', at: 1 }), consult({ id: 'other', repoId: 'r2', at: 0 })];
    expect(nextConsult(q, 'r1', ['ada', 'bob'], 3)).toEqual({ consult: q[1], agentId: 'ada' });
    expect(nextConsult(q, 'r1', [], 3)).toBeNull();
  });

  it('waits for a named agent until they are free', () => {
    const q = [consult({ id: 'n', agentId: 'bob' })];
    expect(nextConsult(q, 'r1', ['ada'], 3)).toBeNull();
    expect(nextConsult(q, 'r1', ['ada', 'bob'], 3)?.agentId).toBe('bob');
  });

  it('runs at most the cap at once', () => {
    const q = [consult({ id: 'a', runningOn: 'ada' }), consult({ id: 'b', runningOn: 'cy' }), consult({ id: 'c' })];
    expect(nextConsult(q, 'r1', ['bob'], 2)).toBeNull();
    expect(nextConsult(q, 'r1', ['bob'], 3)?.consult.id).toBe('c');
  });
});

describe('consultRefusal (read-only)', () => {
  it('refuses edits, the shell and every other tool', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Agent', 'WebFetch', 'mcp__github__create_pull_request']) expect(consultRefusal(tool)).toMatch(/read-only/);
  });

  it('lets it read', () => {
    for (const tool of ['Read', 'Glob', 'Grep']) expect(consultRefusal(tool)).toBeNull();
  });
});

describe('consult prompt and answer', () => {
  it('asks for file:line references and passes the hint on', () => {
    const p = consultPrompt({ question: 'How does approval work?', hint: 'as a security reviewer', floor: 1 }, 'o/keel', 'Morgan');
    expect(p).toMatch(/floor 1 \(o\/keel\), as a security reviewer/);
    expect(p).toMatch(/file:line/);
    expect(p).toMatch(/no shell, edits, commits, pushes or pull requests/);
  });

  it('says who answered, capped', () => {
    expect(consultAnswer('Ada', 1, 'See engine/approvals.mjs:120')).toBe('Ada on floor 1 says:\nSee engine/approvals.mjs:120');
    expect(consultAnswer('Ada', 1, 'x'.repeat(10_000)).length).toBeLessThanOrEqual(CONSULT_ANSWER_MAX + 30);
  });
});
