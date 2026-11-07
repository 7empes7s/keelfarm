import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyTrouble, ownLoginStep, signInLink, signInMessage, signInSteps, SignInBurst } from './keyTrouble.ts';

// Recorded (and trimmed) outputs of Claude Code and Codex when their API key stops working.
const OUT_OF_CREDIT = [
  'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
  'Credit balance is too low',
  'API Error: 402 Payment Required · billing problem on your account',
  '{"type":"error","error":{"type":"billing_error","message":"…"}}',
  'API Error: 400 You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.',
  'Your organization has hit its monthly spend limit.',
  'stream error: unexpected status 429 Too Many Requests: {"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota"}}',
];
const INVALID = [
  'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
  'Invalid API key · Please run /login',
  "unexpected status 401 Unauthorized: Incorrect API key provided: sk-proj-****abcd. You can find your API key at https://platform.openai.com/account/api-keys.",
  '{"error":{"code":"invalid_api_key"}}',
];
const NEITHER = ['API Error: 401 · Login expired · Please run /login', 'Claude usage limit reached. Your limit will reset at 5pm', 'error: tests failed (3)', ''];

describe('keyTrouble', () => {
  it.each(OUT_OF_CREDIT)('reads out of credit: %s', (text) => expect(keyTrouble(text)).toBe('out-of-credit'));
  it.each(INVALID)('reads a key turned away: %s', (text) => expect(keyTrouble(text)).toBe('invalid'));
  it.each(NEITHER)('leaves other failures alone: %s', (text) => expect(keyTrouble(text)).toBeNull());
});

describe('ownLoginStep', () => {
  it('takes an agent off the key while it has trouble, and puts them back once it has none (a new key, or Use the key again)', () => {
    expect(ownLoginStep(undefined, 'out-of-credit')).toEqual({ ownLogin: 'out-of-credit', note: 'off' });
    expect(ownLoginStep('out-of-credit', 'out-of-credit')).toEqual({ ownLogin: 'out-of-credit', note: null });
    expect(ownLoginStep('out-of-credit', null)).toEqual({ ownLogin: undefined, note: 'back' });
    expect(ownLoginStep(undefined, null)).toEqual({ ownLogin: undefined, note: null });
  });
});

describe('the guided steps', () => {
  it('names the agent and the three steps for one, a summary for several', () => {
    expect(signInSteps('Ken', 'claude')).toHaveLength(3);
    const one = signInMessage(['Ken'], 'claude', 'out-of-credit');
    expect(one).toBe(
      "☁️ Ken's cloud machine ran out of API credit. Sign Ken in with your Claude account to carry on: 1) Tap Open Ken's terminal. 2) It shows a sign-in link: tap it and approve in Claude. 3) Copy the code Claude shows, paste it into the terminal and press Enter. Ken carries on by themselves.",
    );
    expect(signInMessage(['Ken', 'Ada'], 'claude', 'out-of-credit')).toMatch(/^☁️ 2 cloud agents need signing in: the API key ran out of credit\./);
    expect(signInMessage(['Ken'], 'codex', 'invalid')).toMatch(/turned away.*ChatGPT/);
  });

  it('finds the latest sign-in link on the screen', () => {
    expect(signInLink('If the browser didn\'t open, visit: https://claude.ai/oauth/authorize?code=true&client_id=x&state=y\nPaste code here if prompted >')).toBe('https://claude.ai/oauth/authorize?code=true&client_id=x&state=y');
    expect(signInLink('old https://a.example/1\nnew https://b.example/2')).toBe('https://b.example/2');
    expect(signInLink('nothing here')).toBeNull();
  });
});

describe('SignInBurst', () => {
  afterEach(() => vi.useRealTimers());

  it('tells about agents switched together once, each agent once, and a later one in a burst of its own', () => {
    vi.useFakeTimers();
    const told: string[][] = [];
    const burst = new SignInBurst<{ id: string }>(5_000, (items) => told.push(items.map((i) => i.id)));
    burst.add({ id: 'ken' });
    vi.advanceTimersByTime(2_000);
    burst.add({ id: 'ada' });
    burst.add({ id: 'ken' });
    expect(told).toEqual([]);
    vi.advanceTimersByTime(3_000);
    expect(told).toEqual([['ken', 'ada']]);
    burst.add({ id: 'lin' });
    vi.advanceTimersByTime(5_000);
    expect(told).toEqual([['ken', 'ada'], ['lin']]);
  });
});
