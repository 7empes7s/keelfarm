import { describe, expect, it } from 'vitest';
import { accountSource, anthropicCosts, boxSource, codexPlan, codexReadings, elevenLabsSource, openaiCosts, resetsIn, usageAlerts, usageLine, worstFirst } from './usageSources';
import type { AccountView, UsageSource } from './types';

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const HOUR = 3_600_000;

// Recorded from `codex app-server` 0.166.0 (account/rateLimits/read), ids and credits trimmed.
const CODEX_APP = {
  ordinaryUsageAllowed: true,
  rateLimits: {
    limitId: 'codex',
    primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1794117952 },
    secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1794685312 },
    credits: { hasCredits: false, unlimited: false, balance: '0' },
    planType: 'plus',
    rateLimitReachedType: null,
  },
};
// The backend's shape (chatgpt.com/backend-api/wham/usage), as codex-cli-usage reads it.
const CODEX_WHAM = { plan_type: 'pro', rate_limit: { primary_window: { used_percent: 97, limit_window_seconds: 18000, reset_at: 1794117952 }, secondary_window: { used_percent: 55, limit_window_seconds: 604800, reset_at: 1794685312 } } };
// GET /v1/user/subscription (ElevenLabs docs' example, trimmed).
const ELEVEN = { tier: 'creator', character_count: 61234, character_limit: 100000, can_extend_character_limit: true, next_character_count_reset_unix: 1795000000, voice_limit: 30, status: 'active' };
// GET /v1/organizations/cost_report: amounts in cents, as decimal strings.
const ANTHROPIC = { data: [{ starting_at: '2026-11-07T00:00:00Z', ending_at: '2026-11-08T00:00:00Z', results: [{ currency: 'USD', amount: '1250.5', description: null }] }, { starting_at: '2026-11-08T00:00:00Z', ending_at: '2026-11-09T00:00:00Z', results: [{ currency: 'USD', amount: '320' }, { currency: 'USD', amount: '80' }] }], has_more: false, next_page: null };
// GET /v1/organization/costs: amounts in dollars.
const OPENAI = { object: 'page', data: [{ object: 'bucket', start_time: 1794441600, end_time: 1794528000, results: [{ object: 'organization.costs.result', amount: { value: 1.5, currency: 'usd' }, line_item: null, project_id: null }] }, { object: 'bucket', start_time: 1794528000, end_time: 1794614400, results: [{ object: 'organization.costs.result', amount: { value: 0.25, currency: 'usd' } }] }], has_more: false };

const account = (o: Partial<AccountView>): AccountView => ({
  id: 'claude-login',
  cli: 'claude',
  kind: 'subscription-login',
  label: 'Claude login on this computer',
  tags: [],
  priority: 0,
  enabled: true,
  status: 'ready',
  until: null,
  usage: [],
  keyHint: '',
  configDir: null,
  todayUsd: 0,
  todaySessions: 0,
  limitHits7d: 0,
  agents: [],
  running: 0,
  signIn: null,
  ...o,
});

const src = (id: string, pct: number, o: Partial<UsageSource> = {}): UsageSource => ({ id, provider: 'claude', category: 'coding', label: id, plan: '', windows: [{ name: 'Weekly', usedPct: pct, resetsAt: NOW + 10 * HOUR }], status: pct >= 100 ? 'limited' : pct >= 80 ? 'near' : 'ready', checkedAt: NOW, ...o });

describe('adapters', () => {
  it("reads Codex app-server's rate limits as 5-hour and weekly readings", () => {
    expect(codexReadings(CODEX_APP, NOW)).toEqual([
      { type: 'five_hour', pct: 40, resetsAt: 1794117952000, at: NOW },
      { type: 'seven_day', pct: 10, resetsAt: 1794685312000, at: NOW },
    ]);
    expect(codexPlan(CODEX_APP)).toBe('Plus');
  });

  it("reads the backend's limit_window_seconds shape too, and nothing from junk", () => {
    expect(codexReadings(CODEX_WHAM, NOW).map((r) => [r.type, r.pct])).toEqual([
      ['five_hour', 97],
      ['seven_day', 55],
    ]);
    expect(codexPlan(CODEX_WHAM)).toBe('Pro');
    expect(codexReadings(null, NOW)).toEqual([]);
    expect(codexReadings({ error: true }, NOW)).toEqual([]);
  });

  it("reads ElevenLabs' subscription as characters used of the limit", () => {
    const s = elevenLabsSource(ELEVEN, NOW);
    expect(s).toMatchObject({ id: 'elevenlabs', provider: 'elevenlabs', category: 'audio', plan: 'Creator', status: 'ready' });
    expect(s.windows).toEqual([{ name: 'Characters', usedPct: 61, used: 61234, limit: 100000, unit: 'chars', resetsAt: 1795000000000 }]);
    expect(elevenLabsSource({ ...ELEVEN, character_count: 95000 }, NOW).status).toBe('near');
    expect(elevenLabsSource({}, NOW).status).toBe('error');
  });

  it("sums Anthropic's cost report (cents) and OpenAI's costs (dollars)", () => {
    expect(anthropicCosts(ANTHROPIC)).toEqual({ usd7d: 16.51, lastDayUsd: 4 });
    expect(openaiCosts(OPENAI)).toEqual({ usd7d: 1.75, lastDayUsd: 0.25 });
    expect(openaiCosts({})).toEqual({ usd7d: 0, lastDayUsd: 0 });
  });

  it("turns an API-key account's spend into a window against its daily cap", () => {
    const s = accountSource(account({ id: 'claude-apikey', kind: 'api-key', label: 'Anthropic API', todayUsd: 18.5, dailyCostCap: 20, status: 'near' }), 41.2, NOW);
    expect(s.windows[0]).toMatchObject({ name: 'Today', usedPct: 93, used: 18.5, limit: 20, unit: '$' });
    expect(s).toMatchObject({ spendUsd7d: 41.2, status: 'near', plan: 'API', accountId: 'claude-apikey' });
  });

  it('counts Boxes against the plan limit', () => {
    expect(boxSource({ total: 9, running: 2 }, 10, NOW)).toMatchObject({ status: 'near', windows: [{ used: 9, limit: 10, usedPct: 90 }] });
  });
});

describe('order and words', () => {
  it('puts the worst row first: limited, signed out, error, near, then fullest', () => {
    const list = [src('a', 20), src('b', 85), src('c', 100), src('d', 0, { status: 'signed-out' }), src('e', 50, { status: 'error' }), src('f', 40)];
    expect(worstFirst(list).map((s) => s.id)).toEqual(['c', 'd', 'e', 'b', 'f', 'a']);
  });

  it('gives the CEO one compact line per source, worst first', () => {
    const eleven = elevenLabsSource(ELEVEN, NOW);
    expect(usageLine([src('rvuese', 12), src('claude-login', 98), eleven])).toBe('claude-login week 98% near · elevenlabs 61% of 100k chars · rvuese week 12%');
  });

  it('says when a window resets', () => {
    expect(resetsIn(NOW + 3 * HOUR, NOW)).toBe('in 3h');
    expect(resetsIn(NOW + 25 * 60_000, NOW)).toBe('in 25 min');
    expect(resetsIn(NOW - 1, NOW)).toBeNull();
  });
});

describe('notifications', () => {
  it('fires once when a window crosses 90%, not again in the same window, again in the next', () => {
    const first = usageAlerts([src('claude-login', 85)], [], NOW);
    expect(first.alerts).toEqual([]);
    const crossed = usageAlerts([src('claude-login', 92)], first.sent, NOW);
    expect(crossed.alerts.map((a) => a.title)).toEqual(['claude-login is at 92%']);
    const again = usageAlerts([src('claude-login', 97, { windows: [{ name: 'Weekly', usedPct: 97, resetsAt: NOW + 10 * HOUR + 30_000 }] })], crossed.sent, NOW + 60_000);
    expect(again.alerts).toEqual([]); // the same window: a reset a few seconds off is the same one
    const next = usageAlerts([src('claude-login', 95, { windows: [{ name: 'Weekly', usedPct: 95, resetsAt: NOW + 178 * HOUR }] })], again.sent, NOW + 11 * HOUR);
    expect(next.alerts).toHaveLength(1);
  });

  it('tells a limited source once, and a window without a reset again only after it went back under', () => {
    const boxes = (n: number) => boxSource({ total: n, running: 0 }, 10, NOW);
    const hit = usageAlerts([boxes(10)], [], NOW);
    expect(hit.alerts[0].title).toBe('Upstash Boxes is at its limit');
    expect(usageAlerts([boxes(10)], hit.sent, NOW).alerts).toEqual([]);
    const under = usageAlerts([boxes(5)], hit.sent, NOW);
    expect(usageAlerts([boxes(10)], under.sent, NOW).alerts).toHaveLength(1);
    const limited = usageAlerts([src('codex-login', 40, { status: 'limited' })], [], NOW);
    expect(limited.alerts.map((a) => a.title)).toEqual(['codex-login is at its limit']);
    expect(usageAlerts([src('codex-login', 40, { status: 'limited' })], limited.sent, NOW).alerts).toEqual([]);
  });
});
