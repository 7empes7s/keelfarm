import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  accountSetup,
  accountSpend,
  accountStatus,
  ACCOUNT_KEY_ENV,
  applyPatch,
  builtInAccounts,
  builtInDir,
  checkBinding,
  cleanTags,
  limitedBy,
  moveAccount,
  loginPlanName,
  normaliseAccounts,
  planWarning,
  removal,
  resolveAccount,
} from './accounts';
import type { ProviderAccount } from './types';

const acc = (x: Partial<ProviderAccount> & { id: string }): ProviderAccount => ({ cli: 'claude', kind: 'subscription-login', label: x.id, tags: [], priority: 1, enabled: true, ...x });
const registry = () => normaliseAccounts([acc({ id: 'max2', tags: ['max', 'backup'], priority: 1 }), acc({ id: 'api1', kind: 'api-key', tags: ['api'], priority: 2 }), acc({ id: 'cx', cli: 'codex', kind: 'api-key', tags: ['api'] })]);

describe('resolveAccount', () => {
  it('runs everyone on the login on this computer until another account is added', () => {
    const list = normaliseAccounts(undefined);
    expect(resolveAccount(list, undefined, 'claude')?.id).toBe('claude-login');
    expect(resolveAccount(list, undefined, 'codex')?.id).toBe('codex-login');
    expect(resolveAccount(list, 'rotation', 'claude')?.builtIn).toBe(true);
  });

  it('takes a pinned id, then a tag, then the rotation', () => {
    const list = registry();
    expect(resolveAccount(list, 'api1', 'claude')?.id).toBe('api1');
    expect(resolveAccount(list, 'max', 'claude')?.id).toBe('max2');
    expect(resolveAccount(list, 'api', 'codex')?.id).toBe('cx');
    expect(resolveAccount(list, '', 'claude')?.id).toBe('claude-login'); // priority 0
    expect(resolveAccount(list, 'nope', 'claude')?.id).toBe('claude-login');
    expect(resolveAccount(list, 'cx', 'claude')?.id).toBe('claude-login'); // another coding agent's account
  });

  it('skips paused accounts in the rotation and for tags, but keeps a pinned one; never one being removed', () => {
    const list = registry().map((a) => (a.id === 'claude-login' ? { ...a, enabled: false } : a.id === 'max2' ? { ...a, enabled: false } : a));
    expect(resolveAccount(list, undefined, 'claude')?.id).toBe('api1');
    expect(resolveAccount(list, 'max', 'claude')?.id).toBe('api1');
    expect(resolveAccount(list, 'max2', 'claude')?.id).toBe('max2');
    const removing = list.map((a) => (a.id === 'api1' ? { ...a, removing: true } : a));
    expect(resolveAccount(removing, 'api1', 'claude')).toBeNull();
  });
});

describe('a session on an account', () => {
  it('changes nothing for the built-in login, which is CLAUDE_CONFIG_DIR or ~/.claude', () => {
    const [claude] = builtInAccounts();
    expect(accountSetup(claude, '/x', '')).toEqual({ env: {}, keyEnv: null });
    expect(builtInDir(path.join, 'claude', { CLAUDE_CONFIG_DIR: '/cfg' }, '/home/m')).toBe('/cfg');
    expect(builtInDir(path.join, 'claude', {}, '/home/m')).toBe(path.join('/home/m', '.claude'));
    expect(builtInDir(path.join, 'codex', {}, '/home/m')).toBe(path.join('/home/m', '.codex'));
  });

  it("points another login's CLI at its own folder", () => {
    expect(accountSetup(acc({ id: 'max2' }), '/h/accounts/max2/claude', '').env).toEqual({ CLAUDE_CONFIG_DIR: '/h/accounts/max2/claude' });
    expect(accountSetup(acc({ id: 'c2', cli: 'codex' }), '/h/accounts/c2/codex', '').env).toEqual({ CODEX_HOME: '/h/accounts/c2/codex' });
  });

  it('gives a Claude API key through apiKeyHelper only, never ANTHROPIC_API_KEY', () => {
    const s = accountSetup(acc({ id: 'api1', kind: 'api-key' }), '', 'sk-ant-secret');
    expect(s).toEqual({ env: { [ACCOUNT_KEY_ENV]: 'sk-ant-secret' }, keyEnv: ACCOUNT_KEY_ENV });
    expect(Object.keys(s.env).some((k) => k.startsWith('ANTHROPIC'))).toBe(false);
    expect(accountSetup(acc({ id: 'api1', kind: 'api-key' }), '', '')).toEqual({ env: {}, keyEnv: null });
    expect(accountSetup(acc({ id: 'cx', cli: 'codex', kind: 'api-key' }), '', 'sk-x').env).toEqual({ OPENAI_API_KEY: 'sk-x', CODEX_API_KEY: 'sk-x' });
  });
});

describe('accountStatus', () => {
  const now = Date.parse('2026-11-07T12:00:00');
  const base = { account: acc({ id: 'a' }), signedIn: true, usage: [], todayUsd: 0, now };
  it('reads paused, signed out, limited, near and ready', () => {
    expect(accountStatus({ ...base, account: acc({ id: 'a', enabled: false }) }).status).toBe('paused');
    expect(accountStatus({ ...base, signedIn: false }).status).toBe('signed-out');
    expect(accountStatus({ ...base, usage: [{ type: 'five_hour', pct: 100, resetsAt: now + 7200_000, at: now }] })).toEqual({ status: 'limited', until: now + 7200_000 });
    expect(accountStatus({ ...base, account: acc({ id: 'a', limitedUntil: now + 60_000 }) })).toEqual({ status: 'limited', until: now + 60_000 });
    expect(accountStatus({ ...base, usage: [{ type: 'seven_day', pct: 85, resetsAt: null, at: now }] }).status).toBe('near');
    expect(accountStatus(base).status).toBe('ready');
  });
  it('counts an API key over its daily cap as limited until midnight', () => {
    const r = accountStatus({ ...base, account: acc({ id: 'a', kind: 'api-key', dailyCostCap: 5 }), todayUsd: 5.2 });
    expect(r.status).toBe('limited');
    expect(new Date(r.until!).getHours()).toBe(0);
  });
  it('counts a full window whose reset has passed as ready, not near or limited (#442)', () => {
    const week = { type: 'seven_day', pct: 100, resetsAt: now - 2 * 3600_000, at: now - 30 * 3600_000 };
    expect(accountStatus({ ...base, usage: [week] })).toEqual({ status: 'ready', until: null });
    expect(accountStatus({ ...base, usage: [{ ...week, resetsAt: now + 3600_000 }] }).status).toBe('limited');
  });
  it('says which limit holds a limited account (#383)', () => {
    const week = { type: 'seven_day', pct: 100, resetsAt: now + 50 * 3600_000, at: now };
    const five = { type: 'five_hour', pct: 100, resetsAt: now + 2 * 3600_000, at: now };
    expect(limitedBy([week, five], accountStatus({ ...base, usage: [week, five] }).until, now)).toBe('weekly');
    expect(limitedBy([five], accountStatus({ ...base, usage: [five] }).until, now)).toBe('5-hour');
    expect(limitedBy([], now + 60_000, now)).toBeNull(); // a session's hit: no reading says
  });
});

describe('the plan a login really has (#442)', () => {
  it('reads it from .credentials.json fields', () => {
    expect(loginPlanName('max', 'default_claude_max_20x')).toBe('Max 20x');
    expect(loginPlanName('pro', 'default_claude_ai')).toBe('Pro');
    expect(loginPlanName(undefined, 'x')).toBeNull();
  });
  it('warns when it is not the plan the label, plan field or tags say', () => {
    const ultra = { label: 'Claude Ultra', tags: [] as string[] };
    expect(planWarning(ultra, 'Pro')).toBe('This login is Pro, not Ultra: sign in with the Ultra account.');
    expect(planWarning({ label: 'Backup', plan: 'Max', tags: [] }, 'Pro')).toBe('This login is Pro, not Max: sign in with the Max account.');
    expect(planWarning({ label: 'Backup', tags: ['max'] }, 'Pro 5x')).toMatch(/^This login is Pro 5x, not Max/);
    expect(planWarning(ultra, 'Max 20x')).toBeNull();
    expect(planWarning({ label: 'Max · keelops', tags: ['backup'] }, 'Max 5x')).toBeNull();
    expect(planWarning({ label: 'Second login', tags: [] }, 'Pro')).toBeNull();
    expect(planWarning(ultra, null)).toBeNull();
  });
});

describe('the manager’s edits', () => {
  it('checks bindings with a message the CEO can act on', () => {
    expect(checkBinding(registry(), 'MAX')).toBe('max');
    expect(checkBinding(registry(), 'rotation')).toBeUndefined();
    expect(checkBinding(registry(), '')).toBeUndefined();
    expect(() => checkBinding(registry(), 'gold')).toThrow(/No account or tag "gold".*max2.*tags: max, backup, api/);
  });

  it('moves accounts among their coding agent’s only', () => {
    const moved = moveAccount(registry(), 'api1', -1);
    const order = moved.filter((a) => a.cli === 'claude').sort((a, b) => a.priority - b.priority).map((a) => a.id);
    expect(order).toEqual(['claude-login', 'api1', 'max2']);
    expect(moved.find((a) => a.id === 'cx')?.priority).toBe(1);
  });

  it('removes at once, waits for running sessions, and keeps the built-in login', () => {
    expect(removal(acc({ id: 'a' }), 0)).toBe('now');
    expect(removal(acc({ id: 'a' }), 2)).toBe('wait');
    expect(removal(builtInAccounts()[0], 0)).toBe('refused');
  });

  it('cleans tags and patches', () => {
    expect(cleanTags('Max, backup  max rotation !bad')).toEqual(['max', 'backup']);
    expect(applyPatch(acc({ id: 'a' }), { label: ' Work ', dailyCostCap: '12', enabled: false })).toMatchObject({ label: 'Work', dailyCostCap: 12, enabled: false });
    expect(() => applyPatch(acc({ id: 'a' }), { label: '' })).toThrow(/needs a name/);
    expect(() => applyPatch(acc({ id: 'a' }), { dailyCostCap: -1 })).toThrow(/cost cap/);
  });

  it("adds up today's spend per account, older lines counting for the built-in Claude login", () => {
    const now = Date.parse('2026-11-07T12:00:00');
    const lines = [{ at: now - 1000, usd: 1.5, account: 'api1' }, { at: now - 2000, usd: 0.25 }, { at: now - 86_400_000, usd: 9, account: 'api1' }];
    expect(accountSpend(lines, { id: 'api1', cli: 'claude' }, now)).toEqual({ usd: 1.5, sessions: 1 });
    expect(accountSpend(lines, builtInAccounts()[0], now)).toEqual({ usd: 0.25, sessions: 1 });
  });
});
