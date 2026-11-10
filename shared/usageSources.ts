// Usage for every account and provider (#361), pure: each provider's answer as windows, an account as a source, the
// worst row first, the CEO's one line, the 90% notifications (once per window) and "resets in 3h".
import { barName, isReset, livePct, readingOf } from './usage.ts';
import type { AccountView, UsageReading, UsageSource, UsageSourceStatus, UsageWindow } from './types.ts';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** A source is near its limit from here (as Providers & accounts' chip). */
const NEAR_PCT = 80;
/** One notification when a window crosses this, or a source becomes limited. */
const ALERT_PCT = 90;

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const pctOf = (used: number, limit: number) => (limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : null);
const secOrMs = (v: unknown) => {
  const n = num(v);
  return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : null;
};

/** The status of a source from its windows: limited at 100%, near from NEAR_PCT. */
function windowsStatus(windows: readonly UsageWindow[]): UsageSourceStatus {
  const worst = worstPct(windows);
  return worst >= 100 ? 'limited' : worst >= NEAR_PCT ? 'near' : 'ready';
}

export const worstPct = (windows: readonly UsageWindow[]) => Math.max(0, ...windows.map((w) => w.usedPct ?? 0));

// ---------- Codex (codex app-server account/rateLimits/read) ----------

/** A Codex window's length as Claude's limit types, so Codex accounts' readings rank and rotate like Claude's. */
const codexType = (mins: number) => (mins === 300 ? 'five_hour' : mins === 10080 ? 'seven_day' : `window_${Math.round(mins)}m`);

/**
 * Codex's rate limits as readings: app-server's `{ rateLimits: { primary: { usedPercent, windowDurationMins, resetsAt } } }`,
 * or the backend's `{ rate_limit: { primary_window: { used_percent, limit_window_seconds, reset_at } } }`.
 */
export function codexReadings(body: unknown, now: number): UsageReading[] {
  const b = obj(body);
  const app = obj(b.rateLimits);
  const wham = obj(b.rate_limit);
  return [
    [app.primary, wham.primary_window],
    [app.secondary, wham.secondary_window],
  ].flatMap(([a, w]) => {
    const x = obj(a ?? w);
    const mins = a ? num(x.windowDurationMins) : num(x.limit_window_seconds) / 60;
    if (!Number.isFinite(mins) || mins <= 0) return [];
    return readingOf({ type: codexType(mins), percent: a ? x.usedPercent : x.used_percent, resetsAt: a ? x.resetsAt : x.reset_at }, now) ?? [];
  });
}

/** Codex's plan ("plus" → "Plus"), '' when it doesn't say. */
export function codexPlan(body: unknown): string {
  const b = obj(body);
  const p = obj(b.rateLimits).planType ?? b.plan_type;
  return typeof p === 'string' && /^[a-z_]{1,20}$/i.test(p) ? p.charAt(0).toUpperCase() + p.slice(1) : '';
}

// ---------- ElevenLabs (GET /v1/user/subscription) ----------

export function elevenLabsSource(body: unknown, now: number): UsageSource {
  const b = obj(body);
  const used = num(b.character_count);
  const limit = num(b.character_limit);
  const windows: UsageWindow[] =
    Number.isFinite(used) && Number.isFinite(limit) ? [{ name: 'Characters', usedPct: pctOf(used, limit), used, limit, unit: 'chars', resetsAt: secOrMs(b.next_character_count_reset_unix) }] : [];
  const tier = typeof b.tier === 'string' ? b.tier.replace(/_/g, ' ').slice(0, 30) : '';
  return {
    id: 'elevenlabs',
    provider: 'elevenlabs',
    category: 'audio',
    label: 'ElevenLabs',
    plan: tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : '',
    windows,
    status: windows.length ? windowsStatus(windows) : 'error',
    checkedAt: now,
    ...(windows.length ? {} : { note: "ElevenLabs' answer had no character count" }),
  };
}

// ---------- API costs with an Admin key ----------

export interface CostSum {
  usd7d: number;
  lastDayUsd: number; // the newest daily bucket's
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Anthropic's /v1/organizations/cost_report: daily buckets whose results' `amount` is in cents (a decimal string). */
export function anthropicCosts(body: unknown): CostSum {
  return sumBuckets(obj(body).data, (r) => (String(r.currency ?? 'USD').toUpperCase() === 'USD' ? num(r.amount) / 100 : 0));
}

/** OpenAI's /v1/organization/costs: daily buckets whose results' `amount.value` is in dollars. */
export function openaiCosts(body: unknown): CostSum {
  return sumBuckets(obj(body).data, (r) => {
    const a = obj(r.amount);
    return String(a.currency ?? 'usd').toLowerCase() === 'usd' ? num(a.value) : 0;
  });
}

function sumBuckets(data: unknown, amount: (r: Record<string, unknown>) => number): CostSum {
  const buckets = (Array.isArray(data) ? data : []).map((d) =>
    (Array.isArray(obj(d).results) ? (obj(d).results as unknown[]) : []).reduce<number>((s, r) => {
      const v = amount(obj(r));
      return s + (Number.isFinite(v) ? v : 0);
    }, 0),
  );
  return { usd7d: cents(buckets.reduce((s, v) => s + v, 0)), lastDayUsd: cents(buckets.at(-1) ?? 0) };
}

/** An organisation's API spend as a source: no limit, just dollars today and this week. */
export function orgSource(provider: 'anthropic' | 'openai', c: CostSum, now: number): UsageSource {
  return {
    id: `${provider}-org`,
    provider,
    category: 'text',
    label: provider === 'anthropic' ? 'Anthropic API · organisation' : 'OpenAI API · organisation',
    plan: 'API',
    windows: [{ name: 'Today', usedPct: null, used: c.lastDayUsd, unit: '$', resetsAt: null }],
    spendUsd7d: c.usd7d,
    status: 'ready',
    checkedAt: now,
    note: 'From the provider’s cost report (Admin key)',
  };
}

// ---------- accounts and Boxes ----------

const nextMidnight = (now: number) => {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
};

/** A Claude or Codex account from Providers & accounts: its 5-hour and weekly readings, or an API key's spend against its cap. */
export function accountSource(a: AccountView, spendUsd7d: number, now: number): UsageSource {
  const api = a.kind === 'api-key';
  const windows: UsageWindow[] = api
    ? [{ name: 'Today', usedPct: a.dailyCostCap ? pctOf(a.todayUsd, a.dailyCostCap) : null, used: a.todayUsd, ...(a.dailyCostCap ? { limit: a.dailyCostCap } : {}), unit: '$', resetsAt: nextMidnight(now) }]
    : a.usage.map((r) => ({ name: barName(r.type), usedPct: livePct(r, now), resetsAt: r.resetsAt }));
  const status: UsageSourceStatus = a.status === 'paused' ? 'ready' : a.status;
  const newest = a.usage.length ? Math.max(...a.usage.map((r) => r.at)) : null;
  const note = api
    ? "From the office's cost ledger"
    : !a.usage.length
      ? a.status === 'signed-out'
        ? 'Not signed in'
        : 'No reading yet: it updates while an agent works on it'
      : a.usage.some((r) => isReset(r, now))
        ? 'Reset, waiting for a new reading'
        : undefined;
  return {
    id: a.id,
    provider: a.cli,
    category: 'coding',
    label: a.label,
    plan: a.plan ?? (api ? 'API' : ''),
    windows,
    ...(api ? { spendUsd7d } : {}),
    status,
    checkedAt: api ? now : newest,
    ...(note ? { note } : {}),
    accountId: a.id,
    agents: a.agents,
  };
}

/** The accounts that get a row: enabled ones, but not a built-in login with no reading that nothing runs on (Codex not set up here). */
export const shownAccounts = (list: readonly AccountView[]) => list.filter((a) => a.enabled && !(a.builtIn && a.cli === 'codex' && !a.usage.length && !a.running && !a.agents.length));

/** Upstash Boxes in use against the plan's Box limit. */
export function boxSource(b: { total: number; running: number }, limit: number, now: number): UsageSource {
  const windows: UsageWindow[] = [{ name: 'Boxes', usedPct: pctOf(b.total, limit), used: b.total, limit, unit: 'Boxes', resetsAt: null }];
  return { id: 'upstash', provider: 'upstash', category: 'cloud', label: 'Upstash Boxes', plan: '', windows, status: windowsStatus(windows), checkedAt: now, note: `${b.running} running` };
}

// ---------- order, history, words ----------

const RANK: Record<UsageSourceStatus, number> = { limited: 0, 'signed-out': 1, error: 2, near: 3, ready: 4 };

/** The worst row first: limited, signed out, in error, near, ready; then the fullest window. */
export function worstFirst(list: readonly UsageSource[]): UsageSource[] {
  return [...list].sort((a, b) => RANK[a.status] - RANK[b.status] || worstPct(b.windows) - worstPct(a.windows) || a.label.localeCompare(b.label));
}

const HISTORY_STEP = 30 * 60_000;

/** A source's history with `pct` now: a sample every half hour (the worst in it), the last day. */
export function pushHistory(hist: readonly [number, number][], pct: number, now: number): [number, number][] {
  const kept = hist.filter(([at]) => now - at < DAY);
  const last = kept.at(-1);
  if (last && now - last[0] < HISTORY_STEP) return [...kept.slice(0, -1), [last[0], Math.max(last[1], pct)]];
  return [...kept, [now, pct]];
}

/** "in 25 min", "in 3h", "in 2 days"; null without a time or once it's past. */
export function resetsIn(at: number | null, now: number): string | null {
  if (at === null || at <= now) return null;
  const min = Math.ceil((at - now) / 60_000);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `in ${h}h` : `in ${Math.round(h / 24)} days`;
}

const compact = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);
const SHORT: Record<string, string> = { '5-hour': '5h', Weekly: 'week', 'Weekly Opus': 'week Opus', 'Weekly Sonnet': 'week Sonnet' };

/** A window in a few words: "week 98%", "61% of 100k chars", "$3.20 today of $20", "4 of 10 Boxes". */
export function windowWords(w: UsageWindow): string {
  if (w.unit === '$') return `$${(w.used ?? 0).toFixed(2)} ${w.name.toLowerCase()}${w.limit ? ` of $${w.limit}` : ''}`;
  if (w.unit && w.limit !== undefined) return w.unit === 'chars' ? `${w.usedPct ?? 0}% of ${compact(w.limit)} chars` : `${w.used ?? 0} of ${w.limit} ${w.unit}`;
  return `${SHORT[w.name] ?? w.name} ${w.usedPct ?? 0}%`;
}

/** The fullest window, or the first. */
const worstWindow = (s: UsageSource) => [...s.windows].sort((a, b) => (b.usedPct ?? -1) - (a.usedPct ?? -1))[0];

/** company_status's usage: one compact line, a source each, worst first ("claude-login week 98% near · codex-login 5h 40%"). */
export function usageLine(list: readonly UsageSource[]): string {
  if (!list.length) return 'no usage sources';
  return worstFirst(list)
    .map((s) => {
      const w = worstWindow(s);
      return [s.id, w ? windowWords(w) : 'no reading', s.status === 'ready' ? '' : s.status].filter(Boolean).join(' ');
    })
    .join(' · ');
}

// ---------- notifications ----------

export interface UsageAlert {
  key: string;
  title: string;
  text: string;
}

/** A window's key for "already told": the source, the window and its reset (to the hour, as readings jitter). */
const alertKey = (s: UsageSource, w: UsageWindow) => `${s.id}|${w.name}|${w.resetsAt === null ? '-' : Math.round(w.resetsAt / HOUR)}`;

/**
 * The notifications due: a window at ALERT_PCT or more, or a source limited with none that full, each once per
 * window (a new reset is a new window). `sent` keeps the keys told; a window without a reset is forgotten once it's
 * back under, and one with a reset once that has passed.
 */
export function usageAlerts(list: readonly UsageSource[], sent: readonly string[], now: number): { alerts: UsageAlert[]; sent: string[] } {
  const hot = new Set<string>();
  const alerts: UsageAlert[] = [];
  for (const s of list) {
    const full = s.windows.filter((w) => (w.usedPct ?? 0) >= ALERT_PCT);
    const keys = full.map((w) => [alertKey(s, w), w] as const);
    if (s.status === 'limited' && !full.length) keys.push([`${s.id}|limited|-`, { name: 'limit', usedPct: 100, resetsAt: null }]);
    for (const [key, w] of keys) {
      hot.add(key);
      if (sent.includes(key) || alerts.some((a) => a.key === key)) continue;
      const when = resetsIn(w.resetsAt, now);
      const limited = (w.usedPct ?? 0) >= 100 || s.status === 'limited';
      alerts.push({
        key,
        title: limited ? `${s.label} is at its limit` : `${s.label} is at ${w.usedPct}%`,
        text: `${w.name === 'limit' ? 'Its limit was reached' : windowWords(w)}${when ? `, resets ${when}` : ''}. Move agents to another account or slow down.`,
      });
    }
  }
  const keep = sent.filter((k) => {
    const reset = Number(k.split('|')[2]);
    return Number.isFinite(reset) ? reset * HOUR + HOUR > now : hot.has(k);
  });
  return { alerts, sent: [...keep, ...alerts.map((a) => a.key)].slice(-200) };
}
