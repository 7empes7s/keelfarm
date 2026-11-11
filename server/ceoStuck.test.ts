import { describe, expect, it } from 'vitest';
import { ceoStuckKind, ceoStuckText, switchBackTo } from './ceoStuck.ts';

describe('a stuck CEO (#375)', () => {
  it("names the account and what's needed, and offers the way back", () => {
    const t = ceoStuckText('Mimoun', 'sign-in', 'Pro secondary', 'Claude Ultra');
    expect(t.line).toBe('⚠️ Mimoun is stuck on Pro secondary: sign-in needed.');
    expect(t.title).toBe('Mimoun is stuck on Pro secondary');
    expect(t.body).toBe('Sign-in needed. Sign Pro secondary in, or switch back to Claude Ultra.');
    expect(ceoStuckText('Mimoun', 'silent', null, null).body).toBe('No answer for a minute. Open their terminal to see why.');
  });

  it("maps the session's blocked states to the card's kinds", () => {
    expect(['sign-in', 'setup', 'silent', 'not-started', 'menu', 'error'].map((k) => ceoStuckKind(k as never))).toEqual(['sign-in', 'setup', 'silent', 'silent', 'other', 'other']);
  });

  it('switches back to the account it last answered on, else the office default when pinned, else nowhere', () => {
    expect(switchBackTo('claude-rvuese', 'claude-login', 'claude-rvuese')).toBe('claude-login');
    expect(switchBackTo('claude-rvuese', 'claude-rvuese', 'claude-rvuese')).toBe('');
    expect(switchBackTo('claude-rvuese', null, 'claude-rvuese')).toBe('');
    expect(switchBackTo(null, null, undefined)).toBeNull();
  });
});
