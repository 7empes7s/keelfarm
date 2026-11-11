import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeLoginCheck, readClaudeLogin } from './accountCheck.ts';
import { loginOwner, loginPlan } from './usagePoll.ts';

describe('a Claude login’s Test (#442)', () => {
  it('counts an expired access token with a refresh token as signed in, to refresh on its next session', () => {
    expect(claudeLoginCheck({ error: 'expired', refresh: true })).toMatchObject({ signedIn: true, refresh: true, note: '✓ Signed in; its token refreshes on its next session.' });
    expect(claudeLoginCheck({ error: 'expired', refresh: false }).signedIn).toBe(false);
    expect(claudeLoginCheck({ error: 'no-login' }).signedIn).toBe(false);
    expect(claudeLoginCheck({ readings: [] }).signedIn).toBe(true);
  });

  it('reads the plan from .credentials.json and never a token', () => {
    const raw = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-secret', refreshToken: 'sk-ant-ort-secret', subscriptionType: 'pro', rateLimitTier: 'default_claude_ai' } });
    expect(loginPlan(raw)).toBe('Pro');
    expect(loginPlan(JSON.stringify({ claudeAiOauth: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' } }))).toBe('Max 20x');
    expect(loginPlan('not json')).toBeNull();
  });

  it('reads who a login belongs to from its .claude.json, beside the default ~/.claude too (#460)', async () => {
    expect(loginOwner(JSON.stringify({ oauthAccount: { accountUuid: 'AB-12', emailAddress: 'a@b.c' } }))).toBe('ab-12');
    expect(loginOwner(JSON.stringify({ oauthAccount: { emailAddress: 'Me@B.c' } }))).toBe('me@b.c');
    expect(loginOwner('{}')).toBeNull();
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'login-'));
    const dir = path.join(home, '.claude');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'secret', subscriptionType: 'pro' } }));
    await fs.writeFile(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'u1' } }));
    expect(await readClaudeLogin(dir)).toEqual({ plan: 'Pro', who: 'u1' });
    await fs.writeFile(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'u2' } }));
    expect(await readClaudeLogin(dir)).toEqual({ plan: 'Pro', who: 'u2' });
    await fs.rm(home, { recursive: true, force: true });
  });
});
