import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAccount, claudeLoginCheck, keyNote, loginFileState, readClaudeLogin, setupTokenNote } from './accountCheck.ts';
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

describe("the built-in Claude login's sign-in from its file, no request (#579)", () => {
  const now = Date.UTC(2026, 10, 12, 12);
  const cred = (o: object) => JSON.stringify({ claudeAiOauth: { accessToken: 'secret', ...o } });

  it("reads the token's state", () => {
    expect(loginFileState(cred({ expiresAt: now + 60_000 }), now)).toBe('in');
    expect(loginFileState(cred({ expiresAt: now - 60_000, refreshToken: 'r' }), now)).toBe('refresh');
    expect(loginFileState(cred({ expiresAt: now - 60_000 }), now)).toBe('out');
    expect(loginFileState('{}', now)).toBe('out');
  });
});

describe('what a check says about a sign-in (#637)', () => {
  it("never calls a network failure, a 429 or a 5xx signed out, nor a made-up Ready: it's no news", () => {
    expect(claudeLoginCheck({ error: 'failed' })).toMatchObject({ auth: 'error', signedIn: true });
    for (const status of [0, 429, 500, 529]) expect(keyNote(status, 'Anthropic').auth).toBe('error');
    expect(keyNote(200, 'OpenAI').auth).toBe('ok');
    expect(keyNote(401, 'OpenAI')).toMatchObject({ auth: 'out', signedIn: false });
    expect(keyNote(403, 'OpenAI').auth).toBe('out'); // a key's model list: 403 turns the key away
    expect(setupTokenNote(403).auth).toBe('ok'); // the usage endpoint's 403 is its scope, not a dead token
    expect(setupTokenNote(401).auth).toBe('out');
    expect(setupTokenNote(429).auth).toBe('error');
  });

  it("reads Codex's and Gemini CLI's login files, not just their existence, in the folder their sessions use", async () => {
    const now = Date.now();
    const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp: Math.floor(exp / 1000) })).toString('base64url')}.sig`;
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-'));
    const check = (cli: 'codex' | 'gemini') => checkAccount({ cli, kind: 'subscription-login' }, home, '');
    const codex = (v: string) => fs.writeFile(path.join(home, 'auth.json'), v);
    expect((await check('codex')).auth).toBe('out'); // missing
    await codex('');
    expect((await check('codex')).auth).toBe('out'); // empty
    await codex('{"tokens": ');
    expect((await check('codex')).auth).toBe('out'); // malformed
    await codex(JSON.stringify({ tokens: { access_token: jwt(now - 60_000), refresh_token: 'rt-secret' } }));
    expect(await check('codex')).toMatchObject({ auth: 'refresh', signedIn: true, refresh: true });
    await codex(JSON.stringify({ tokens: { access_token: jwt(now - 60_000) } }));
    expect((await check('codex')).auth).toBe('out'); // expired, nothing to refresh it
    await codex(JSON.stringify({ OPENAI_API_KEY: 'sk-secret' }));
    const key = await check('codex');
    expect(key.auth).toBe('ok');
    expect(key.fileAt).toBeGreaterThan(0);
    await fs.mkdir(path.join(home, '.gemini'));
    const gemini = (v: string) => fs.writeFile(path.join(home, '.gemini', 'oauth_creds.json'), v);
    expect((await check('gemini')).auth).toBe('out');
    await gemini('{}');
    expect((await check('gemini')).auth).toBe('out');
    await gemini(JSON.stringify({ access_token: 'at-secret', refresh_token: 'rt-secret', expiry_date: now - 1000 }));
    expect((await check('gemini')).auth).toBe('refresh');
    await gemini(JSON.stringify({ access_token: 'at-secret', refresh_token: 'rt-secret', expiry_date: now + 3_600_000 }));
    const g = await check('gemini');
    expect(g.auth).toBe('ok');
    expect(JSON.stringify([key, g])).not.toMatch(/secret/); // no token in what goes to the card
    await fs.rm(home, { recursive: true, force: true });
  });
});
