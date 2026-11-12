import { describe, expect, it } from 'vitest';
import type { CostSession } from './costs.ts';
import { fileTicket, emptyTickets } from './itTickets.ts';
import { agentErrorProblem, blockedProblem, causeTrends, digest, digestDue, emptyProblems, groupProblems, loadProblems, needsHumanProblem, noteInput, pruneProblems, qaRepeatProblem, recordProblem, recurring, register, resolveProblems, sessionProblem, updateProblem, worstFirst, type ProblemInput } from './problems.ts';

const NOW = Date.UTC(2026, 10, 12, 10);
const MIN = 60_000;
const HOUR = 60 * MIN;
const R = 'o/app';
const line = (over: Partial<CostSession>): CostSession => ({ type: 'session', at: NOW, ms: 20 * MIN, repoId: R, agentId: 'a1', agent: 'Ada', kind: 'qa', issue: 5, pr: 12, round: 1, model: 'm', effort: 'medium', usd: 1.5, tokens: null, outcome: 'qa-fail', ...over });
const qa = { repoId: R, prNumber: 12, issueNumber: 5, stuckWhy: 'it failed QA 3 times', escalated: false };
const F3 = { floor: 3 };

describe('each automatic source creates the right entry', () => {
  it('a failed QA round by its cause', () => {
    for (const cause of ['bug', 'nit', 'spec-missing'] as const) {
      const p = sessionProblem(line({ cause }), F3)!;
      expect(p).toMatchObject({ kind: 'work', cause, floor: 3, repoId: R, pr: 12, issue: 5, agentId: 'a1', owner: 'agents', lostMs: 20 * MIN, lostUsd: 1.5, key: `round:${cause}:${R}#12` });
    }
  });

  it('a merge conflict and red checks from their fix sessions', () => {
    expect(sessionProblem(line({ kind: 'fix-conflict', outcome: 'commit', cause: 'conflict' }), F3)).toMatchObject({ cause: 'conflict', title: 'Merge conflict on PR #12' });
    expect(sessionProblem(line({ kind: 'fix-checks', outcome: 'commit', cause: 'checks' }), F3)).toMatchObject({ cause: 'checks' });
  });

  it("lab errors and CI outages are IT's, a passed round is nothing", () => {
    expect(sessionProblem(line({ cause: 'lab-error' }), F3)).toBeNull();
    expect(sessionProblem(line({ cause: 'outage', kind: 'fix-checks', outcome: 'commit' }), F3)).toBeNull();
    expect(sessionProblem(line({ outcome: 'qa-pass' }), F3)).toBeNull();
  });

  it('a session that ended without a result is waste', () => {
    expect(sessionProblem(line({ kind: 'issue', pr: null, outcome: 'no-pr' }), F3)).toMatchObject({ cause: 'waste', owner: 'agents', title: 'issue #5: ended without a PR', key: `waste:${R}:issue #5` });
    expect(sessionProblem(line({ kind: 'ceo-review', repoId: '', issue: null, pr: null, outcome: 'ceo-idle' }), F3)).toMatchObject({ cause: 'waste', owner: 'ceo', floor: null });
    expect(sessionProblem(line({ kind: 'issue', outcome: 'pr' }), F3)).toBeNull();
  });

  it("a PR needing a human: the CEO's while it triages, the manager's once escalated", () => {
    expect(needsHumanProblem(qa, F3)).toMatchObject({ cause: 'needs-human', owner: 'ceo', ongoing: true, detail: 'it failed QA 3 times' });
    expect(needsHumanProblem(qa, F3).needsYou).toBeUndefined();
    expect(needsHumanProblem({ ...qa, escalated: true }, F3)).toMatchObject({ owner: 'manager', needsYou: true });
  });

  it('a PR failing QA 3 times, an agent in error, an issue blocked', () => {
    expect(qaRepeatProblem(qa, 3, F3)).toMatchObject({ cause: 'qa-3x', title: 'PR #12 failed QA 3 times', owner: 'ceo' });
    expect(agentErrorProblem({ id: 'a2', name: 'Bo', error: 'spawn ENOENT', repoId: R, issue: 7 }, F3)).toMatchObject({ cause: 'agent-error', agentId: 'a2', agentName: 'Bo', detail: 'spawn ENOENT', ongoing: true });
    expect(blockedProblem({ repoId: R, number: 9, blockers: [4, 6] }, F3)).toMatchObject({ cause: 'blocked', issue: 9, title: 'Issue #9 waits on #4, #6' });
  });

  it("the CEO's note is a process problem; a bad one says what to fix", () => {
    expect(noteInput({ cause: 'vague-brief', title: 'Issue #3 had no acceptance criteria' }, { floor: 2, repoId: R })).toMatchObject({ kind: 'process', cause: 'vague-brief', owner: 'ceo', floor: 2 });
    expect(noteInput({ title: 'x', owner: 'manager' }, { floor: null, repoId: null })).toMatchObject({ cause: 'process', needsYou: true });
    expect(() => noteInput({ title: '  ' }, { floor: null, repoId: null })).toThrow(/title/);
  });

  it('an IT ticket is infrastructure, owned by IT', () => {
    const t = emptyTickets();
    fileTicket(t, { what: 'Port taken', where: 'ports', evidence: 'EADDRINUSE', blocking: true }, { id: 'a1', name: 'Ada' }, NOW - HOUR);
    const [p] = register([], t.list);
    expect(p).toMatchObject({ id: 't1', kind: 'infrastructure', cause: 'ports', owner: 'it', state: 'open', agentId: 'a1', ongoing: true });
  });
});

describe('the register', () => {
  it('de-duplicates: a repeat joins the open entry and adds what it lost', () => {
    const s = emptyProblems();
    recordProblem(s, sessionProblem(line({ cause: 'bug' }), F3)!, NOW - HOUR);
    const { problem, joined } = recordProblem(s, sessionProblem(line({ kind: 'fix-qa', outcome: 'commit', cause: 'bug', usd: 0.5, ms: 10 * MIN }), F3)!, NOW);
    expect(joined).toBe(true);
    expect(s.list).toHaveLength(1);
    expect(problem).toMatchObject({ count: 2, lostUsd: 2, lostMs: 30 * MIN, lastAt: NOW });
    // once resolved, the same key opens a new entry
    resolveProblems(s, () => true, 'PR #12 merged', NOW);
    expect(recordProblem(s, sessionProblem(line({ cause: 'bug' }), F3)!, NOW).joined).toBe(false);
    expect(s.list.map((p) => p.state)).toEqual(['open', 'resolved']);
  });

  it('an escalation moves the open needs-human entry to the manager', () => {
    const s = emptyProblems();
    recordProblem(s, needsHumanProblem(qa, F3), NOW - HOUR);
    const p = recordProblem(s, needsHumanProblem({ ...qa, escalated: true }, F3), NOW).problem;
    expect(p).toMatchObject({ owner: 'manager', needsYou: true, count: 2 });
    resolveProblems(s, (x) => x.cause === 'needs-human', 'Back in the flow', NOW + HOUR);
    expect(p).toMatchObject({ state: 'resolved', lostMs: 2 * HOUR });
    expect(p.needsYou).toBeUndefined();
  });

  it('ranks the worst first by time and dollars lost; ongoing ones count while open', () => {
    const s = emptyProblems();
    const mk = (key: string, lostMs: number, lostUsd: number, ongoing = false) => recordProblem(s, { kind: 'work', cause: 'waste', title: key, floor: 1, repoId: R, pr: null, issue: null, agentId: null, owner: 'agents', key, lostMs, lostUsd, ...(ongoing && { ongoing: true as const }) }, NOW - 3 * HOUR).problem;
    mk('cheap', 5 * MIN, 0.1);
    mk('pricey', 10 * MIN, 4); // 10 + 120
    mk('long', 60 * MIN, 0); // 60
    mk('waiting', 0, 0, true); // 180 by now
    expect(worstFirst(s.list, NOW).map((p) => p.title)).toEqual(['waiting', 'pricey', 'long', 'cheap']);
  });

  it('groups by cause and floor, the worst group first, and flags recurring ones', () => {
    const s = emptyProblems();
    for (const pr of [1, 2, 3]) recordProblem(s, sessionProblem(line({ kind: 'fix-conflict', outcome: 'commit', cause: 'conflict', pr }), F3)!, NOW);
    recordProblem(s, sessionProblem(line({ cause: 'bug', pr: 4 }), { floor: 1 })!, NOW);
    const groups = groupProblems(s.list, NOW);
    expect(groups.map((g) => g.key)).toEqual(['conflict:3', 'bug:1']);
    expect(groups[0]).toMatchObject({ count: 3, lostUsd: 4.5 });
    expect(recurring(groups[0].items[0], s.list, NOW)).toBe(true);
    expect(recurring(groups[1].items[0], s.list, NOW)).toBe(false);
  });

  it('trends per cause: this week against the week before', () => {
    const s = emptyProblems();
    recordProblem(s, sessionProblem(line({ cause: 'bug', pr: 1 }), F3)!, NOW - 10 * 24 * HOUR);
    recordProblem(s, sessionProblem(line({ cause: 'bug', pr: 2 }), F3)!, NOW);
    recordProblem(s, sessionProblem(line({ cause: 'bug', pr: 3 }), F3)!, NOW);
    expect(causeTrends(s.list, NOW)).toEqual([{ cause: 'bug', week: 2, before: 1 }]);
  });

  it('updates: IT tickets are refused, resolving needs a resolution', () => {
    const s = emptyProblems();
    const p = recordProblem(s, noteInput({ title: 'QA never opens the phone layout' }, { floor: 1, repoId: R }), NOW).problem;
    expect(() => updateProblem(s, 't4', { state: 'resolved' }, NOW)).toThrow(/IT ticket #4/);
    expect(() => updateProblem(s, p.id, { state: 'resolved' }, NOW)).toThrow(/resolution/);
    expect(() => updateProblem(s, p.id, { state: 'done' }, NOW)).toThrow(/state is one of/);
    expect(updateProblem(s, p.id, { state: 'in-progress', owner: 'manager' }, NOW)).toMatchObject({ state: 'in-progress', owner: 'manager', needsYou: true });
    expect(updateProblem(s, p.id, { state: 'wont-fix', resolution: 'Phones are QA-ed by hand' }, NOW)).toMatchObject({ state: 'wont-fix', resolution: 'Phones are QA-ed by hand' });
    expect(() => updateProblem(s, p.id, { state: 'resolved', resolution: 'x' }, NOW)).toThrow(/already/);
  });

  it('prunes: quiet work problems resolve after 3 days, ongoing ones stay', () => {
    const s = emptyProblems();
    recordProblem(s, sessionProblem(line({ cause: 'nit' }), F3)!, NOW - 4 * 24 * HOUR);
    recordProblem(s, needsHumanProblem(qa, F3), NOW - 4 * 24 * HOUR);
    pruneProblems(s, NOW);
    expect(s.list.map((p) => [p.cause, p.state])).toEqual(expect.arrayContaining([['nit', 'resolved'], ['needs-human', 'open']]));
  });

  it('loads only well-formed entries', () => {
    const s = emptyProblems();
    recordProblem(s, needsHumanProblem(qa, F3), NOW);
    const back = loadProblems(JSON.parse(JSON.stringify({ ...s, list: [...s.list, { id: 'x' }] })));
    expect(back.list).toHaveLength(1);
    expect(back.seq).toBe(1);
  });
});

describe('the daily digest', () => {
  it('counts, the top cause and floor, needs-you first and tappable', () => {
    const s = emptyProblems();
    const conflict = (pr: number) => sessionProblem(line({ kind: 'fix-conflict', outcome: 'commit', cause: 'conflict', pr, ms: 40 * MIN, usd: 0 }), F3)!;
    for (const pr of [1, 2, 3]) recordProblem(s, conflict(pr), NOW - 2 * HOUR);
    recordProblem(s, needsHumanProblem({ ...qa, prNumber: 20, escalated: true }, { floor: 1 }), NOW - 5 * MIN);
    const old: ProblemInput = { ...sessionProblem(line({ cause: 'nit', pr: 30 }), F3)!, lostMs: 0, lostUsd: 0 };
    recordProblem(s, old, NOW - 30 * HOUR);
    resolveProblems(s, (p) => p.cause === 'nit', 'PR #30 merged', NOW - HOUR);
    const d = digest(s.list, NOW);
    expect(d.text).toBe('📋 Yesterday: 4 new problems, 1 resolved; top: merge conflicts on floor 3 cost 2 h; needs you: 1.');
    expect(d.items[0]).toMatchObject({ id: 'p4', needsYou: true, repoId: R, pr: 20, title: 'PR #20 needs a human on floor 1' });
    expect(d.items.slice(1).map((i) => i.pr ?? 0).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(d.items).toHaveLength(4);
  });

  it('a quiet day', () => {
    expect(digest([], NOW).text).toBe('📋 Yesterday: 0 new problems, 0 resolved; needs you: 0.');
  });

  it('is due once a day from its hour, never when off', () => {
    const at = (h: number) => new Date(2026, 10, 12, h).getTime();
    expect(digestDue(at(8), 9, '')).toBeNull();
    expect(digestDue(at(9), 9, '')).toBe('2026-11-12');
    expect(digestDue(at(15), 9, '2026-11-12')).toBeNull();
    expect(digestDue(at(15), -1, '')).toBeNull();
  });
});
