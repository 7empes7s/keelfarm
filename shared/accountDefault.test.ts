import { describe, expect, it } from 'vitest';
import { loadTaskAccounts } from './accountRotation';
import { backText, defaultAccount, defaultsBack, defaultText, makeDefault, pruneTaskAccounts, switchingText, switchNow, taskKey, tasksLeft } from './accountDefault';
import type { AccountStatus, ProviderAccount } from './types';

const acc = (id: string, priority: number, o: Partial<ProviderAccount> = {}): ProviderAccount => ({ id, cli: 'claude', kind: 'subscription-login', label: id, tags: [], priority, enabled: true, ...o });
const PRO = acc('pro', 0, { label: 'Pro' });
const ULTRA = acc('ultra', 1, { label: 'Ultra' });
const KEY = acc('key', 2, { kind: 'api-key' });
const CODEX = acc('codex', 0, { cli: 'codex' });
const withStatus = (list: ProviderAccount[], status: Record<string, AccountStatus>) => list.map((a) => ({ ...a, status: status[a.id] ?? 'ready' }));

describe('taskKey', () => {
  const a = { role: 'worker', repoId: 'r', task: 'issue', issueNumber: 7, prNumber: null };
  it('keys a build or fix task by its issue, else its PR', () => {
    expect(taskKey(a)).toBe('r#7');
    expect(taskKey({ ...a, task: 'fix', issueNumber: null, prNumber: 12 })).toBe('r!12');
  });
  it('leaves QA, the CEO and no task alone', () => {
    expect(taskKey({ ...a, task: 'qa' })).toBeNull();
    expect(taskKey({ ...a, role: 'ceo' })).toBeNull();
    expect(taskKey({ ...a, task: null })).toBeNull();
  });
});

describe('makeDefault', () => {
  it("puts the account first among its coding agent's, keeping the others' order", () => {
    const next = makeDefault([PRO, ULTRA, KEY, CODEX], 'key');
    expect(Object.fromEntries(next.map((a) => [a.id, a.priority]))).toEqual({ key: 0, pro: 1, ultra: 2, codex: 0 });
    expect(defaultAccount(next, 'claude')?.id).toBe('key');
  });
  it('skips a paused account for the default', () => expect(defaultAccount([{ ...PRO, enabled: false }, ULTRA], 'claude')?.id).toBe('ultra'));
});

describe('switchNow and the records', () => {
  const records = { 'r#1': { account: 'pro' }, 'r#2': { account: 'ultra' }, 'r#3': { account: 'codex' } };
  it("marks open tasks on the coding agent's other accounts to move", () => {
    expect(switchNow(records, [PRO, ULTRA, CODEX], 'ultra')).toEqual({ 'r#1': { account: 'pro', move: true }, 'r#2': { account: 'ultra' }, 'r#3': { account: 'codex' } });
  });
  it('keeps only open tasks, and loads what was saved', () => {
    expect(pruneTaskAccounts(records, new Set(['r#2']))).toEqual({ 'r#2': { account: 'ultra' } });
    expect(loadTaskAccounts({ a: { account: 'pro', move: true }, b: { nope: 1 }, c: null })).toEqual({ a: { account: 'pro', move: true } });
    expect(loadTaskAccounts('junk')).toEqual({});
  });
});

describe('tasks left and the words', () => {
  it('counts running tasks off the default, only while the default is free', () => {
    const list = makeDefault([PRO, ULTRA], 'ultra');
    expect(tasksLeft(['pro', 'pro', 'ultra', 'pro'], withStatus(list, {}), 'claude')).toEqual([{ id: 'pro', label: 'Pro', count: 3 }]);
    expect(tasksLeft(['pro'], withStatus(list, { ultra: 'limited' }), 'claude')).toEqual([]);
  });
  it('says what happens', () => {
    const left = [{ id: 'pro', label: 'Pro', count: 3 }];
    expect(defaultText('Ultra', left, false)).toBe('Ultra is the default now: new tasks start on it; 3 agents finish their current task on Pro first.');
    expect(defaultText('Ultra', left, true)).toBe('Ultra is the default now: new tasks start on it; 3 agents on Pro move to it at their next session.');
    expect(defaultText('Ultra', [], false)).toBe('Ultra is the default now: new tasks start on it.');
    expect(switchingText(left)).toBe('switching: 3 tasks left on Pro');
    expect(backText('Ultra')).toBe('Ultra is back: new tasks start on it again.');
  });
});

describe('defaultsBack', () => {
  it('a default that was out and is free again is back, once', () => {
    const first = defaultsBack(new Set(), withStatus([ULTRA, PRO], { pro: 'limited' }), ['claude']);
    expect(first).toEqual({ back: [], out: new Set(['pro']) });
    const second = defaultsBack(first.out, withStatus([ULTRA, PRO], {}), ['claude']);
    expect(second.back.map((a) => a.id)).toEqual(['pro']);
    expect(defaultsBack(second.out, withStatus([ULTRA, PRO], {}), ['claude']).back).toEqual([]);
  });
  it("says nothing for a coding agent with one account: the office's pause covers it", () => {
    expect(defaultsBack(new Set(['pro']), withStatus([PRO], {}), ['claude']).back).toEqual([]);
  });
});
