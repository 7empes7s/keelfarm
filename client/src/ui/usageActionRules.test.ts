import { describe, expect, it } from 'vitest';
import type { AccountKind, UsageProvider, UsageSourceStatus } from '../../../shared/types';
import { backAt, chipAction, rowAction, settingsTarget, usageActions, type UsageContext } from './usageActionRules';

const STATUSES: UsageSourceStatus[] = ['ready', 'near', 'limited', 'signed-out', 'error'];
const ids = (provider: UsageProvider, status: UsageSourceStatus, ctx: UsageContext = {}, account = true) => usageActions({ id: account ? 'acc-1' : provider, provider, status, ...(account ? { accountId: 'acc-1' } : {}) }, ctx).map((a) => (a.primary ? `*${a.id}` : a.id));

describe('usage card actions (#404)', () => {
  it('maps every status of every kind of row to its actions, the recommended one first', () => {
    const kinds: [string, UsageProvider, UsageContext, boolean][] = [
      ['claude login', 'claude', { kind: 'subscription-login', enabled: true, isDefault: false }, true],
      ['claude default login', 'claude', { kind: 'subscription-login', enabled: true, isDefault: true }, true],
      ['claude api key', 'claude', { kind: 'api-key', enabled: true, isDefault: false }, true],
      ['claude setup token', 'claude', { kind: 'setup-token', enabled: true, isDefault: false }, true],
      ['codex login', 'codex', { kind: 'subscription-login', enabled: true, isDefault: false }, true],
      ['elevenlabs', 'elevenlabs', {}, false],
      ['upstash', 'upstash', {}, false],
      ['anthropic org', 'anthropic', {}, false],
      ['gemini key', 'gemini', {}, false],
    ];
    const table = Object.fromEntries(kinds.map(([name, p, ctx, acc]) => [name, Object.fromEntries(STATUSES.map((st) => [st, ids(p, st, ctx, acc).join(' ')]))]));
    expect(table).toEqual({
      'claude login': {
        ready: 'sign-in make-default agents rest plan settings mission',
        near: '*agents sign-in make-default rest plan settings mission',
        limited: '*notify-back sign-in agents rest plan settings mission',
        'signed-out': '*sign-in agents rest plan settings mission',
        error: 'sign-in make-default agents rest plan settings mission',
      },
      'claude default login': {
        ready: 'sign-in agents rest plan settings mission',
        near: '*agents sign-in rest plan settings mission',
        limited: '*notify-back sign-in agents rest plan settings mission',
        'signed-out': '*sign-in agents rest plan settings mission',
        error: 'sign-in agents rest plan settings mission',
      },
      'claude api key': {
        ready: 'make-default agents rest plan settings mission',
        near: '*agents make-default rest plan settings mission',
        limited: '*notify-back agents rest plan settings mission',
        'signed-out': '*settings agents rest plan mission',
        error: 'make-default agents rest plan settings mission',
      },
      'claude setup token': {
        ready: 'make-default agents rest plan settings mission',
        near: '*agents make-default rest plan settings mission',
        limited: '*notify-back agents rest plan settings mission',
        'signed-out': '*settings agents rest plan mission',
        error: 'make-default agents rest plan settings mission',
      },
      'codex login': {
        ready: 'sign-in make-default agents rest plan settings mission',
        near: '*agents sign-in make-default rest plan settings mission',
        limited: '*notify-back sign-in agents rest plan settings mission',
        'signed-out': '*sign-in agents rest plan settings mission',
        error: 'sign-in make-default agents rest plan settings mission',
      },
      elevenlabs: {
        ready: 'voice plan settings mission',
        near: '*plan voice settings mission',
        limited: '*notify-back voice plan settings mission',
        'signed-out': '*voice plan settings mission',
        error: '*voice plan settings mission',
      },
      upstash: {
        ready: 'provider plan settings mission',
        near: 'provider plan settings mission',
        limited: '*notify-back provider plan settings mission',
        'signed-out': '*provider plan settings mission',
        error: '*provider plan settings mission',
      },
      'anthropic org': {
        ready: 'provider mission',
        near: 'provider mission',
        limited: '*notify-back provider mission',
        'signed-out': '*provider mission',
        error: '*provider mission',
      },
      'gemini key': {
        ready: 'provider mission',
        near: 'provider mission',
        limited: '*notify-back provider mission',
        'signed-out': '*provider mission',
        error: '*provider mission',
      },
    });
  });

  it('says what each account action is for, and Resume for a resting one', () => {
    const labels = (kind: AccountKind, provider: UsageProvider = 'claude', enabled = true) => usageActions({ id: 'a', accountId: 'a', provider, status: 'ready' }, { kind, enabled }).map((a) => a.label);
    expect(labels('subscription-login')).toEqual(expect.arrayContaining(['Sign in again', 'Use for new work', 'Pin or unpin agents', 'Rest this account', 'Open in Settings', 'Mission control → Usage']));
    expect(labels('subscription-login', 'codex')).toContain('Move agents to or from Codex');
    expect(labels('subscription-login', 'claude', false)).toContain('Resume');
    expect(labels('subscription-login', 'claude', false)).not.toContain('Use for new work');
    expect(usageActions({ id: 'a', accountId: 'a', provider: 'claude', status: 'limited' }, { kind: 'subscription-login', watching: true })[0].label).toBe("We'll tell you when it's back");
    // With nothing that reaches the phone, the button says so instead of pretending (#538).
    expect(usageActions({ id: 'a', accountId: 'a', provider: 'claude', status: 'limited' }, { kind: 'subscription-login', reach: false })[0].label).toBe('Notify me (not on your phone yet)');
    expect(usageActions({ id: 'a', accountId: 'a', provider: 'claude', status: 'limited' }, { kind: 'subscription-login', reach: true })[0].label).toBe("Notify me when it's back");
  });

  it('opens the provider pages in a new tab and Settings at the right card', () => {
    expect(usageActions({ id: 'elevenlabs', provider: 'elevenlabs', status: 'ready' }).find((a) => a.id === 'plan')?.href).toMatch(/^https:\/\/elevenlabs\.io\//);
    expect(usageActions({ id: 'a', accountId: 'a', provider: 'claude', status: 'ready' }, { kind: 'subscription-login' }).find((a) => a.id === 'plan')?.href).toBe('https://claude.ai/settings/usage');
    expect(settingsTarget({ id: 'a', provider: 'claude', accountId: 'a' })).toEqual({ tab: 'accounts', card: 'acc-card-a' });
    expect(settingsTarget({ id: 'elevenlabs', provider: 'elevenlabs' })).toEqual({ tab: 'voice' });
    expect(settingsTarget({ id: 'upstash', provider: 'upstash' })).toEqual({ tab: 'cloud-agents' });
    expect(settingsTarget({ id: 'openai-org', provider: 'openai' })).toEqual({ tab: 'providers', card: 'pv-usage-openai-org' });
  });

  it('shows only the recommended action on the row, and the chip signs a signed-out account in', () => {
    const login = { kind: 'subscription-login' as const, enabled: true };
    expect(rowAction({ id: 'a', accountId: 'a', provider: 'claude', status: 'ready' }, login)).toBeNull();
    expect(rowAction({ id: 'a', accountId: 'a', provider: 'claude', status: 'signed-out' }, login)?.label).toBe('Sign in');
    expect(chipAction({ id: 'a', accountId: 'a', provider: 'claude', status: 'signed-out' }, login)).toBe('sign-in');
    expect(chipAction({ id: 'a', accountId: 'a', provider: 'claude', status: 'signed-out' }, { kind: 'api-key' })).toBe('settings');
    expect(chipAction({ id: 'a', accountId: 'a', provider: 'claude', status: 'limited' }, login)).toBe('detail');
    expect(chipAction({ id: 'elevenlabs', provider: 'elevenlabs', status: 'signed-out' })).toBe('voice');
  });

  it("knows when a limited source is back: its account's until, else the soonest full window's reset", () => {
    const now = 1_000_000;
    const windows = [
      { name: '5-hour', usedPct: 100, resetsAt: now + 3_000 },
      { name: 'Weekly', usedPct: 100, resetsAt: now + 9_000 },
      { name: 'Opus', usedPct: 40, resetsAt: now + 1_000 },
    ];
    expect(backAt({ status: 'limited', windows }, null, now)).toBe(now + 3_000);
    expect(backAt({ status: 'limited', windows }, now + 5_000, now)).toBe(now + 5_000);
    expect(backAt({ status: 'limited', windows: [] }, null, now)).toBeNull();
    expect(backAt({ status: 'ready', windows }, now + 5_000, now)).toBeNull();
  });
});
