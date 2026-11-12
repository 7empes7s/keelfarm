import { describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { afterPoll, IDLE_MS, MAX_BACKOFF_MS, noFiveHourWindow, oauthReadings, pollDue, pollWait, POLL_MS, tokenOf, type UsageCheck } from './usagePoll.ts';

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 6, 12, 0);
const never = { lastTry: 0, failures: 0 };

describe('pollDue', () => {
  it('never checks while sessions are giving readings', () => {
    expect(pollDue(NOW - MIN, never, NOW)).toBe(false);
    expect(pollDue(NOW - IDLE_MS + 1, never, NOW)).toBe(false);
  });

  it('checks once the office has been quiet for 10 minutes, then at most every 12', () => {
    expect(pollDue(NOW - IDLE_MS, never, NOW)).toBe(true);
    expect(pollDue(0, never, NOW)).toBe(true); // no reading at all
    const done = afterPoll(never, true, NOW);
    expect(done).toEqual({ lastTry: NOW, failures: 0 });
    expect(pollDue(NOW - 60 * MIN, done, NOW + POLL_MS - 1)).toBe(false);
    expect(pollDue(NOW - 60 * MIN, done, NOW + POLL_MS)).toBe(true);
    // its own reading at NOW keeps the next check at least IDLE_MS away, and POLL_MS is the longer
    expect(pollDue(NOW, done, NOW + POLL_MS)).toBe(true);
    expect(POLL_MS).toBeLessThanOrEqual(15 * MIN);
  });

  it('backs off after failures, doubling up to two hours, and resets on success', () => {
    expect([0, 1, 2, 3, 4, 10].map(pollWait)).toEqual([POLL_MS, 2 * POLL_MS, 4 * POLL_MS, 8 * POLL_MS, MAX_BACKOFF_MS, MAX_BACKOFF_MS]);
    const failed = afterPoll(afterPoll(never, false, NOW - MIN), false, NOW);
    expect(failed).toEqual({ lastTry: NOW, failures: 2 });
    expect(pollDue(0, failed, NOW + 4 * POLL_MS - 1)).toBe(false);
    expect(pollDue(0, failed, NOW + 4 * POLL_MS)).toBe(true);
    expect(afterPoll(failed, true, NOW).failures).toBe(0);
  });
});

describe('noFiveHourWindow', () => {
  it('is true only when Anthropic sends five_hour as null beside a weekly window (a verified Ultra plan)', () => {
    const week = { utilization: 51, resets_at: '2026-11-17T19:00:00Z' };
    expect(noFiveHourWindow({ five_hour: null, seven_day: week })).toBe(true);
    expect(noFiveHourWindow({ five_hour: { utilization: 99, resets_at: '2026-11-13T01:00:00Z' }, seven_day: week })).toBe(false); // Pro, Max: a real window
    expect(noFiveHourWindow({ seven_day: week })).toBe(false); // not said: nothing assumed
    expect(noFiveHourWindow({ five_hour: null, seven_day: null })).toBe(false);
    expect(noFiveHourWindow(null)).toBe(false);
  });
});

describe('oauthReadings', () => {
  it("reads the endpoint's limits as percentages with their resets", () => {
    const body = {
      five_hour: { utilization: 42, resets_at: '2026-11-06T15:00:00.000Z' },
      seven_day: { utilization: 54.4, resets_at: '2026-11-10T08:00:00+00:00' },
      seven_day_opus: null,
      seven_day_oauth_apps: { utilization: null, resets_at: null },
      extra_usage: { is_enabled: false },
    };
    expect(oauthReadings(body, NOW)).toEqual([
      { type: 'five_hour', pct: 42, resetsAt: Date.UTC(2026, 10, 6, 15), at: NOW },
      { type: 'seven_day', pct: 54, resetsAt: Date.UTC(2026, 10, 10, 8), at: NOW },
    ]);
  });

  it('finds nothing in an answer it does not know', () => {
    expect(oauthReadings(null, NOW)).toEqual([]);
    expect(oauthReadings('oops', NOW)).toEqual([]);
    expect(oauthReadings({ error: { type: 'authentication_error' } }, NOW)).toEqual([]);
  });
});

describe('tokenOf', () => {
  const cred = (o: object) => JSON.stringify({ claudeAiOauth: o });
  it('takes the login token, unless it is missing or expired', () => {
    expect(tokenOf(cred({ accessToken: 'tok', expiresAt: NOW + MIN }), NOW)).toEqual({ token: 'tok', refresh: false });
    expect(tokenOf(cred({ accessToken: 'tok' }), NOW)).toEqual({ token: 'tok', refresh: false });
    expect(tokenOf(cred({ accessToken: 'tok', expiresAt: NOW - MIN }), NOW)).toEqual({ error: 'expired', refresh: false });
    expect(tokenOf(cred({ accessToken: 'tok', refreshToken: 'ref', expiresAt: NOW - MIN }), NOW)).toEqual({ error: 'expired', refresh: true });
    expect(tokenOf(cred({}), NOW)).toEqual({ error: 'no-login' });
    expect(tokenOf('{}', NOW)).toEqual({ error: 'no-login' });
    expect(tokenOf('not json', NOW)).toEqual({ error: 'no-login' });
  });
});

// ---------- the office's idle check, end to end on the demo backend ----------

type Internals = {
  pollUsage(): void;
  usagePolling: boolean;
  usageCheck: string | null;
  pausedUntil: number;
  state: { claudeUsage: { type: string; pct: number; resetsAt: number | null; at: number }[] };
};

async function idleOffice(check: () => Promise<UsageCheck>, newest: number) {
  const backend = createDemoBackend();
  const calls = vi.fn(check);
  backend.usageCheck = calls;
  const swarm = new Swarm(backend);
  const x = swarm as unknown as Internals;
  x.state.claudeUsage = [{ type: 'seven_day', pct: 54, resetsAt: null, at: newest }];
  const poll = async () => {
    x.pollUsage();
    for (let n = 0; n < 100 && x.usagePolling; n++) await new Promise((r) => setTimeout(r, 5));
  };
  return { swarm, x, calls, poll };
}

describe('the idle usage check', () => {
  it('updates the meter and company status when nothing has reported for 10 minutes', async () => {
    const { swarm, x, calls, poll } = await idleOffice(async () => ({ readings: [{ type: 'seven_day', pct: 61, resetsAt: null, at: Date.now() }] }), Date.now() - 9 * 60 * MIN);
    await poll();
    expect(calls).toHaveBeenCalledTimes(1);
    expect(x.state.claudeUsage.map((r) => r.pct)).toEqual([61]);
    expect(swarm.snapshot().claudeUsageCheck).toBeNull();
    await poll(); // its own fresh reading holds the next one off
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('never checks while sessions are reporting', async () => {
    const { calls, poll } = await idleOffice(async () => ({ error: 'failed' }), Date.now() - MIN);
    await poll();
    expect(calls).not.toHaveBeenCalled();
  });

  it('keeps the last reading and says why when the check fails, logging nothing', async () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const { swarm, x, poll } = await idleOffice(async () => ({ error: 'expired' }), Date.now() - 9 * 60 * MIN);
    await poll();
    expect(x.state.claudeUsage.map((r) => r.pct)).toEqual([54]);
    expect(swarm.snapshot().claudeUsageCheck).toBe('expired');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it('pauses new work only when the 5-hour or weekly window is full', async () => {
    const resetsAt = Date.now() + 60 * MIN;
    const full = (type: string) => async (): Promise<UsageCheck> => ({ readings: [{ type, pct: 100, resetsAt, at: Date.now() }] });
    const week = await idleOffice(full('seven_day'), 0);
    await week.poll();
    expect(week.x.pausedUntil).toBeGreaterThanOrEqual(resetsAt);
    const opus = await idleOffice(full('seven_day_opus'), 0);
    await opus.poll();
    expect(opus.x.pausedUntil).toBe(0);
  });

  it("with rotation, a full window on the built-in login rests that login, not the office, while another account is free", async () => {
    const resetsAt = Date.now() + 3 * 24 * 60 * MIN; // the weekly window: days away
    const week = await idleOffice(async () => ({ readings: [{ type: 'seven_day', pct: 100, resetsAt, at: Date.now() }] }), 0);
    await week.swarm.accounts.init(); // the demo's seeded accounts
    week.swarm.accounts.update('claude-apikey', { enabled: false }); // only logins: the second one is what's free
    await week.swarm.accounts.test('claude-keelop'); // its second Max is signed in
    await week.poll();
    expect(week.x.pausedUntil).toBe(0);
    const status = (id: string) => week.swarm.accounts.view().accounts.find((a) => a.id === id)?.status;
    expect(status('claude-login')).toBe('limited');
    expect(status('claude-keelop')).not.toBe('limited');
    await week.swarm.accounts.flushed();
  });

  it('with rotation, pauses until the first account is back once every Claude account is out', async () => {
    const resetsAt = Date.now() + 3 * 24 * 60 * MIN;
    const week = await idleOffice(async () => ({ readings: [{ type: 'seven_day', pct: 100, resetsAt, at: Date.now() }] }), 0);
    await week.swarm.accounts.init();
    week.swarm.accounts.update('claude-apikey', { enabled: false });
    await week.swarm.accounts.test('claude-keelop');
    const sooner = Date.now() + 2 * 60 * MIN;
    week.swarm.accounts.limited('claude-keelop', sooner); // the other login is out too, back sooner
    await week.poll();
    expect(week.x.pausedUntil).toBeGreaterThanOrEqual(sooner);
    expect(week.x.pausedUntil).toBeLessThan(resetsAt);
    await week.swarm.accounts.flushed();
  });
});
