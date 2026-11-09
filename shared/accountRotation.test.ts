import { describe, expect, it } from 'vitest';
import { addSpan, allOutText, detectLimit, pickAccount, resetTime, rotationSettings, rotationStats, spanBars, switchText, type Candidate } from './accountRotation';
import type { AccountSwitch, ProviderAccount } from './types';

const NOW = new Date(2026, 10, 7, 13, 0, 0).getTime(); // 13:00 local
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 10, 7 + dayOffset, h, m, 0).getTime();

describe('detectLimit', () => {
  // Recorded shapes: Claude Code's screens and StopFailure lines, the API's errors, Codex's TUI.
  it('reads Claude Code usage limits and their reset', () => {
    expect(detectLimit('Claude AI usage limit reached|1794063600', NOW)).toEqual({ kind: 'limited', until: 1794063600_000 });
    expect(detectLimit('5-hour limit reached ∙ resets 4pm', NOW)).toEqual({ kind: 'limited', until: at(16) });
    expect(detectLimit("You've hit your limit · resets 11am (Europe/Berlin)", NOW)).toEqual({ kind: 'limited', until: at(11, 0, 1) });
    expect(detectLimit('Claude usage limit reached. Your limit will reset at 16:30.', NOW)).toEqual({ kind: 'limited', until: at(16, 30) });
    expect(detectLimit('Weekly limit reached ∙ resets Mon', NOW)).toEqual({ kind: 'limited', until: NOW + 60 * 60_000 });
    expect(detectLimit('Claude Code stopped: rate limit (5-hour limit reached)', NOW)?.kind).toBe('limited');
  });

  it('reads Codex limits', () => {
    const text = "■ You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again in 2 hours 15 minutes.";
    expect(detectLimit(text, NOW)).toEqual({ kind: 'limited', until: NOW + (2 * 60 + 15) * 60_000 });
    expect(detectLimit("You've hit your usage limit. Try again at 3:15 PM.", NOW)).toEqual({ kind: 'limited', until: at(15, 15) });
    expect(detectLimit('stream error: exceeded retry limit, last status: 429 Too Many Requests', NOW)).toEqual({ kind: 'limited', until: NOW + 5 * 60_000 });
  });

  it('reads 429s and an overloaded API as a short limit', () => {
    expect(detectLimit('API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}', NOW)).toEqual({ kind: 'limited', until: NOW + 5 * 60_000 });
    expect(detectLimit('API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', NOW)?.kind).toBe('limited');
  });

  it('reads expired or missing logins as signed out', () => {
    expect(detectLimit('API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}', NOW)).toEqual({ kind: 'signed-out' });
    expect(detectLimit('Invalid API key · Please run /login', NOW)).toEqual({ kind: 'signed-out' });
    expect(detectLimit('Claude Code stopped: authentication failed', NOW)).toEqual({ kind: 'signed-out' });
    expect(detectLimit('Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.', NOW)).toEqual({ kind: 'signed-out' });
  });

  it("reads an API key's billing errors as limited until tomorrow", () => {
    expect(detectLimit('Your credit balance is too low to access the Anthropic API.', NOW)).toEqual({ kind: 'limited', until: at(0, 0, 1) });
    expect(detectLimit('Claude Code stopped: billing error', NOW)).toEqual({ kind: 'limited', until: at(0, 0, 1) });
  });

  it('leaves other failures alone', () => {
    expect(detectLimit('Claude Code stopped: server error', NOW)).toBeNull();
    expect(detectLimit('Fixed PR #429 and pushed', NOW)).toBeNull();
    expect(detectLimit('', NOW)).toBeNull();
  });

  it('never takes a bare number for a time', () => {
    expect(resetTime('resets 4 times', NOW)).toBeNull();
  });
});

const acc = (id: string, o: Partial<ProviderAccount> = {}): ProviderAccount => ({ id, cli: 'claude', kind: 'subscription-login', label: id, tags: [], priority: 0, enabled: true, ...o });
const cand = (account: ProviderAccount, o: Partial<Candidate> = {}): Candidate => ({ account, signedIn: true, usage: [], todayUsd: 0, ...o });
const pick = (binding: string | undefined, list: Candidate[], o: { apiLast?: boolean; skip?: string[]; now?: number } = {}) => pickAccount(binding, list, o.now ?? NOW, { cli: 'claude', apiLast: o.apiLast ?? true, skip: o.skip })?.id ?? null;

describe('pickAccount', () => {
  const main = acc('main', { priority: 0, tags: ['max'] });
  const backup = acc('backup', { priority: 1, tags: ['max', 'backup'] });
  const key = acc('key', { kind: 'api-key', priority: -1, tags: ['api'], dailyCostCap: 10 });
  const codex = acc('codex', { cli: 'codex' });

  it('takes the rotation by priority, API keys last', () => {
    expect(pick(undefined, [cand(key), cand(backup), cand(main), cand(codex)])).toBe('main');
    expect(pick(undefined, [cand(key), cand(backup), cand(main)], { apiLast: false })).toBe('key');
  });

  it('takes the pinned account first, even paused, and the pinned tag next', () => {
    expect(pick('backup', [cand(main), cand(backup)])).toBe('backup');
    expect(pick('backup', [cand(main), cand({ ...backup, enabled: false })])).toBe('backup');
    expect(pick('api', [cand(main), cand(key)])).toBe('key');
  });

  it('skips paused, limited, signed-out, over-cap and tried accounts', () => {
    const limited = { ...main, limitedUntil: NOW + 60_000 };
    expect(pick(undefined, [cand(limited), cand(backup), cand(key)])).toBe('backup');
    expect(pick(undefined, [cand({ ...main, enabled: false }), cand(backup)])).toBe('backup');
    expect(pick(undefined, [cand(main, { signedIn: false }), cand(backup)])).toBe('backup');
    expect(pick('api', [cand(key, { todayUsd: 12 }), cand(main)])).toBe('main');
    expect(pick(undefined, [cand(main), cand(backup)], { skip: ['main'] })).toBe('backup');
    expect(pick('main', [cand(limited), cand(backup, { signedIn: false })])).toBeNull();
  });

  it('leaves an account at 95% of a limit for the next one, unless nothing else is left', () => {
    const full = [{ type: 'five_hour', pct: 96, resetsAt: NOW + 3600_000, at: NOW }];
    expect(pick(undefined, [cand(main, { usage: full }), cand(backup)])).toBe('backup');
    expect(pick(undefined, [cand(main, { usage: full }), cand(backup, { signedIn: false })])).toBe('main');
  });

  it('puts an account back once its reset has passed', () => {
    const limited = { ...main, limitedUntil: at(14) };
    expect(pick(undefined, [cand(limited), cand(backup)], { now: at(13, 59) })).toBe('backup');
    expect(pick(undefined, [cand(limited), cand(backup)], { now: at(14, 1) })).toBe('main');
  });
});

describe('words and numbers', () => {
  const clock = (t: number) => new Date(t).toISOString().slice(11, 16);

  it('says the switch, the way the chat pill shows it', () => {
    expect(switchText({ from: 'Main Max', to: 'Backup Max', why: 'limited', until: Date.UTC(2026, 10, 7, 16) }, clock)).toBe('🔀 Switched to Backup Max: Main Max is limited until 16:00.');
    expect(switchText({ from: 'Main Max', to: 'Backup Max', why: 'signed-out', until: null }, clock)).toBe('🔀 Switched to Backup Max: Main Max is signed out.');
  });

  it('says when every account is out, with the API key to turn on', () => {
    expect(allOutText('Claude', Date.UTC(2026, 10, 7, 16), clock, 'Anthropic API')).toBe('⏸ Every Claude account is out. The first one is back at 16:00; new work waits until then. Or tap Use API key to carry on now on Anthropic API, billed per token.');
    expect(allOutText('Claude', null, clock, null)).toBe('⏸ Every Claude account is out. New work waits until one is signed in again.');
  });

  it("counts today's switches, the minutes they saved and the API spend", () => {
    const s = (o: Partial<AccountSwitch>): AccountSwitch => ({ at: NOW, agentId: 'a', agentName: 'Ada', fromId: 'main', from: 'Main', toId: 'b', to: 'B', why: 'limited', until: NOW + 30 * 60_000, api: false, usd: 0, ...o });
    const stats = rotationStats([s({}), s({ until: NOW + 10 * 3600_000, api: true, usd: 1.234 }), s({ why: 'signed-out', until: null }), s({ at: at(9, 0, -1) })], NOW);
    expect(stats).toMatchObject({ switchesToday: 3, minutesSaved: 30 + 300, apiUsd: 1.23 });
    expect(stats.recent).toHaveLength(4);
  });

  it('merges overlapping limited spans and draws the last day', () => {
    const spans = addSpan(addSpan(undefined, at(9), at(11), NOW), at(10), at(12), NOW);
    expect(spans).toEqual([[at(9), at(12)]]);
    expect(spanBars(spans, NOW)).toEqual([{ left: 20 / 24, width: 3 / 24 }]);
  });

  it('checks the settings', () => {
    expect(rotationSettings(undefined, undefined)).toEqual({ on: true, apiLast: true, ceoClis: [], agentsSwitchCli: true });
    expect(rotationSettings(undefined, { on: false, ceoClis: ['codex', 'opencode', 'codex'] })).toMatchObject({ on: false, ceoClis: ['codex'] });
  });
});
