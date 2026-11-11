import { describe, expect, it } from 'vitest';
import type { Agent } from '../store';
import { floorName, onIt, runWords, taskOf } from './usageWhoRules';

const agent = (id: string, p: Partial<Agent> = {}) => ({ id, name: id, repoId: 'acme/shop', role: 'agent', cli: '', task: null, issueNumber: null, prNumber: null, issueTitle: null, ...p }) as Agent;
const run = (since: number, account = 'codex-login') => ({ account, model: 'gpt-6.1-sol', effort: 'medium', since });

describe('usage sheet rows (#409)', () => {
  it('lists running sessions oldest first, and pinned agents only when nothing of theirs runs here', () => {
    const agents = { ada: agent('ada', { live: run(1) }), bo: agent('bo', { live: run(0, 'claude-login'), account: 'codex-login' }), cy: agent('cy', { live: null }), di: agent('di', { live: run(2) }) };
    const who = onIt('codex-login', ['ada', 'bo', 'cy', 'gone'], agents);
    expect(who.now.map((r) => r.agent.id)).toEqual(['ada', 'di']);
    expect(who.pinned.map((a) => a.id)).toEqual(['bo', 'cy']); // bo is pinned here, but their session runs on Claude's login
    expect(onIt('claude-login', [], agents).now.map((r) => r.agent.id)).toEqual(['bo']); // ada, configured as Claude Code, runs a Codex fallback: not here
  });

  it('says what a session really runs and what its agent works on, with the page it opens', () => {
    expect(runWords('codex', run(0))).toBe('Codex · GPT-6.1-sol · medium');
    expect(runWords('claude', { model: 'claude-opus-5-5', effort: '' })).toBe('Claude Code · Opus 5.5');
    expect(taskOf(agent('ada', { task: 'qa', issueNumber: 3, prNumber: 7 }))).toEqual({ words: 'Testing PR #7', open: { kind: 'card', repoId: 'acme/shop', key: 'pr-7', number: 7, pr: true } });
    expect(taskOf(agent('ada', { task: 'issue', issueNumber: 3, prNumber: 7 })).open).toMatchObject({ key: 'i-3', pr: false });
    expect(taskOf(agent('ada'))).toEqual({ words: 'Between tasks', open: null });
    expect(taskOf(agent('ceo', { role: 'ceo', issueTitle: 'Morning review' }))).toEqual({ words: 'Morning review', open: null });
  });

  it('names floors and the CEO', () => {
    const repos = [{ id: 'acme/shop', floor: 2, fullName: 'acme/shop' }];
    expect(floorName('acme/shop', repos)).toBe('Floor 2 · shop');
    expect(floorName('', repos)).toBe('CEO');
  });
});
