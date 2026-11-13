import { describe, expect, it } from 'vitest';
import { authAfter, authNote, authUsable, codexAuthFile, geminiAuthFile, jwtExp, keyProbe, SESSION_TRIES, type AuthEvidence, type AuthRecord } from './accountAuth.ts';

const fold = (evs: AuthEvidence[], from?: AuthRecord): AuthRecord => evs.reduce<AuthRecord | undefined>((r, e) => authAfter(r, e), from)!;

describe("an account's sign-in state (#637)", () => {
  it('a probe that started before newer evidence never overwrites it', () => {
    const r = fold([{ kind: 'ok', from: 'probe', at: 10 }, { kind: 'out', from: 'session', at: 30, hard: true }, { kind: 'ok', from: 'probe', at: 20 }]);
    expect(r?.state).toBe('signed-out');
    const back = fold([{ kind: 'out', from: 'probe', at: 30 }, { kind: 'ok', from: 'probe', at: 20 }]);
    expect(back?.state).toBe('signed-out'); // an older poll's "ok" after a newer "out"
  });

  it("a probe that couldn't reach the provider keeps what was known, and is never a made-up Ready", () => {
    expect(fold([{ kind: 'error', from: 'probe', at: 1 }])).toMatchObject({ state: 'unknown', stale: true });
    expect(fold([{ kind: 'out', from: 'probe', at: 1 }, { kind: 'error', from: 'probe', at: 2 }])).toMatchObject({ state: 'signed-out', stale: true });
    expect(fold([{ kind: 'ok', from: 'probe', at: 1 }, { kind: 'error', from: 'probe', at: 2 }])).toMatchObject({ state: 'ready', stale: true });
    expect(authNote(fold([{ kind: 'ok', from: 'probe', at: 1 }, { kind: 'error', from: 'probe', at: 2 }]))).toMatch(/Couldn't reach/);
  });

  it("a session's sign-in failure on a login that can refresh is checked and retried, bounded at SESSION_TRIES", () => {
    let r = fold([{ kind: 'refresh', from: 'probe', at: 1 }, { kind: 'out', from: 'session', at: 2 }]);
    expect(r).toMatchObject({ state: 'checking', fails: 1 });
    expect(authUsable(r, true)).toBe(false); // not used while it's checked
    r = authAfter(r, { kind: 'refresh', from: 'probe', at: 3 });
    expect(r.state).toBe('refresh'); // the probe found a refresh token: its next session refreshes it
    expect(authUsable(r, false)).toBe(true);
    r = authAfter(r, { kind: 'out', from: 'session', at: 4 });
    expect(r).toMatchObject({ state: 'signed-out', fails: SESSION_TRIES });
    r = authAfter(r, { kind: 'ok', from: 'probe', at: 5 });
    expect(r.state).toBe('signed-out'); // no endless retry on a token sessions can't use
    expect(authNote(r)).toMatch(/couldn't sign in: tap Sign in again/);
  });

  it("a CLI's own sign-in screen is out at once, but a login file rewritten after it (a sign-in, a refresh) is a fresh login", () => {
    let r = fold([{ kind: 'ok', from: 'file', at: 1 }, { kind: 'out', from: 'session', at: 10, hard: true }]);
    expect(r.state).toBe('signed-out');
    r = authAfter(r, { kind: 'ok', from: 'file', at: 5 }); // the same old file
    expect(r.state).toBe('signed-out');
    r = authAfter(r, { kind: 'ok', from: 'file', at: 20 }); // rewritten since
    expect(r).toMatchObject({ state: 'ready', fails: 0 });
  });

  it('a new sign-in, or a session that ran, clears every earlier sign-out', () => {
    const out = fold([{ kind: 'out', from: 'session', at: 1, hard: true }]);
    expect(authAfter(out, { kind: 'ok', from: 'signin', at: 2 })).toEqual({ state: 'ready', at: 2, fails: 0 });
    expect(authAfter(out, { kind: 'ok', from: 'session', at: 2 })).toEqual({ state: 'ready', at: 2, fails: 0 });
  });

  it('with nothing known, a built-in login or a saved key counts as signed in; another login waits for its probe', () => {
    expect(authUsable(undefined, true)).toBe(true);
    expect(authUsable(undefined, false)).toBe(false);
    expect(authUsable({ state: 'unknown', at: 1, fails: 0, stale: true }, true)).toBe(true);
  });
});

describe("the CLIs' login files and status codes (#637)", () => {
  const now = Date.UTC(2026, 10, 13);
  const jwt = (exp: number) => `h.${btoa(JSON.stringify({ exp: exp / 1000 })).replace(/=+$/, '')}.s`;

  it("reads a JWT's expiry only", () => {
    expect(jwtExp(jwt(now))).toBe(now);
    expect(jwtExp('not-a-jwt')).toBeNull();
    expect(jwtExp(42)).toBeNull();
  });

  it("Codex's auth.json: API key, valid, expired-refreshable, expired, missing, malformed", () => {
    expect(codexAuthFile(JSON.stringify({ OPENAI_API_KEY: 'k' }), now)).toBe('ok');
    expect(codexAuthFile(JSON.stringify({ tokens: { access_token: jwt(now + 1000), refresh_token: 'r' } }), now)).toBe('ok');
    expect(codexAuthFile(JSON.stringify({ tokens: { access_token: jwt(now - 1000), refresh_token: 'r' } }), now)).toBe('refresh');
    expect(codexAuthFile(JSON.stringify({ tokens: { access_token: jwt(now - 1000) } }), now)).toBe('out');
    expect(codexAuthFile(null, now)).toBe('out');
    expect(codexAuthFile('{"tokens"', now)).toBe('out');
    expect(codexAuthFile('[]', now)).toBe('out');
  });

  it("Gemini CLI's oauth_creds.json", () => {
    expect(geminiAuthFile(JSON.stringify({ access_token: 'a', refresh_token: 'r', expiry_date: now + 1 }), now)).toBe('ok');
    expect(geminiAuthFile(JSON.stringify({ access_token: 'a', refresh_token: 'r', expiry_date: now - 1 }), now)).toBe('refresh');
    expect(geminiAuthFile(JSON.stringify({ access_token: 'a', expiry_date: now - 1 }), now)).toBe('out');
    expect(geminiAuthFile('', now)).toBe('out');
  });

  it('HTTP statuses: 2xx ok, 401/403 out, anything else no news', () => {
    expect([200, 204, 401, 403, 429, 500, 0].map(keyProbe)).toEqual(['ok', 'ok', 'out', 'out', 'error', 'error', 'error']);
  });
});
