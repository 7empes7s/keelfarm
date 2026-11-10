import { describe, expect, it } from 'vitest';
import { claudeLoginCheck } from './accountCheck.ts';
import { loginPlan } from './usagePoll.ts';

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
});
