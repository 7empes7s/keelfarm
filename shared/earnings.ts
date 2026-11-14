// Earnings vs. spend (#666): the office's weekly earnings (each floor's feed, plus manual entries) against its total
// spend (Claude sessions from the cost ledger, providers that report spend, fixed monthly costs spread per day), as the
// Company page's card and company_status's `earnings` block. Pure: the state's shape, the edits, the feed reader and
// the weekly aggregation. Weeks start on Monday, local time.
import { dayKey } from './journal.ts';

const DAY_MS = 86_400_000;
const EARNINGS_WEEKS = 8;
const KEEP_DAYS = EARNINGS_WEEKS * 7 + 7;
const MAX_ENTRIES = 500;
const MAX_FIXED = 30;

/** A manual earning: anything without a feed. */
export interface EarningEntry {
  id: string;
  date: string; // YYYY-MM-DD
  usd: number;
  source: string;
  note?: string;
  repoId: string | null; // its floor, or null for the company
  at: number;
}

/** A cost entered once (the server, a subscription), spread evenly over every day. */
export interface FixedCost {
  id: string;
  label: string;
  usdPerMonth: number;
}

/** A floor's earnings feed: the URL, its last read and the days it reported. */
export interface EarningsFeed {
  repoId: string;
  url: string;
  status: 'ok' | 'no-data' | 'pending';
  checkedAt: number | null;
  error?: string;
  days: Record<string, number>; // YYYY-MM-DD → usd, kept from the last good read
}

/** One day's spend that isn't fixed: Claude by floor ('' the CEO) and providers by name. */
export interface SpendDay {
  claude: Record<string, number>;
  providers: Record<string, number>;
}

export interface EarningsState {
  seq: number;
  entries: EarningEntry[];
  fixed: FixedCost[];
  feeds: EarningsFeed[];
  spend: Record<string, SpendDay>; // YYYY-MM-DD → that day's spend, kept past the ledger's 30 days
}

export type CostType = 'claude' | 'providers' | 'fixed';

export interface EarningsWeek {
  start: string; // its Monday, YYYY-MM-DD
  earnings: number;
  spend: number;
  profit: number;
}

/** A floor's (or the company's, repoId null) share of this week. `earnings` null: its feed has no data. */
interface EarningsFloorRow {
  repoId: string | null;
  earnings: number | null;
  spend: number;
}

export interface EarningsView {
  week: EarningsWeek; // this one, so far
  weeks: EarningsWeek[]; // the last 8, oldest first, this one last
  byFloor: EarningsFloorRow[];
  byType: { type: CostType; usd: number }[];
  bySource: { source: string; usd: number }[]; // this week's earnings by where they came from
  noData: string[]; // repoIds whose feed couldn't be read: the earnings miss them, they aren't 0
  feeds: Omit<EarningsFeed, 'days'>[];
  entries: EarningEntry[]; // the last 8 weeks', newest first
  fixed: FixedCost[];
  fixedPerDay: number;
}

export const emptyEarnings = (): EarningsState => ({ seq: 0, entries: [], fixed: [], feeds: [], spend: {} });

const cents = (n: number) => Math.round(n * 100) / 100;
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const money = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The saved state, with anything malformed dropped. */
export function loadEarnings(raw: unknown): EarningsState {
  const r = obj(raw);
  const list = <T>(v: unknown, ok: (x: Record<string, unknown>) => boolean) => (Array.isArray(v) ? v.filter((x) => ok(obj(x))) : []) as T[];
  return {
    seq: typeof r.seq === 'number' ? r.seq : 0,
    entries: list<EarningEntry>(r.entries, (x) => typeof x.id === 'string' && isDay(x.date) && money(x.usd) !== null),
    fixed: list<FixedCost>(r.fixed, (x) => typeof x.id === 'string' && typeof x.label === 'string' && money(x.usdPerMonth) !== null),
    feeds: list<EarningsFeed>(r.feeds, (x) => typeof x.repoId === 'string' && typeof x.url === 'string').map((f) => ({ ...f, days: obj(f.days) as Record<string, number> })),
    spend: obj(r.spend) as Record<string, SpendDay>,
  };
}

// ---------- edits ----------

/** A manual entry, checked; throws a plain reason. */
export function addEntry(s: EarningsState, a: { date?: unknown; usd?: unknown; source?: unknown; note?: unknown; repoId?: unknown }, now: number): EarningEntry {
  const date = a.date === undefined || a.date === '' ? dayKey(now) : a.date;
  if (!isDay(date)) throw new Error('Give the date as YYYY-MM-DD.');
  const usd = money(a.usd);
  if (usd === null || usd === 0 || Math.abs(usd) > 10_000_000) throw new Error('Give an amount in dollars, e.g. 120.50 (negative for a refund).');
  const source = String(a.source ?? '').trim().slice(0, 60);
  if (!source) throw new Error('Say where the money came from, e.g. "Sponsor".');
  const note = String(a.note ?? '').trim().slice(0, 200);
  const e: EarningEntry = { id: `e${++s.seq}`, date, usd: cents(usd), source, ...(note && { note }), repoId: typeof a.repoId === 'string' && a.repoId ? a.repoId : null, at: now };
  s.entries = [e, ...s.entries].slice(0, MAX_ENTRIES);
  return e;
}

/** A fixed monthly cost, checked; throws a plain reason. */
export function addFixed(s: EarningsState, a: { label?: unknown; usdPerMonth?: unknown }): FixedCost {
  const label = String(a.label ?? '').trim().slice(0, 60);
  if (!label) throw new Error('Name the cost, e.g. "Server" or "Claude Max".');
  const usd = money(a.usdPerMonth);
  if (usd === null || usd <= 0 || usd > 1_000_000) throw new Error('Give the monthly cost in dollars, e.g. 38.');
  if (s.fixed.length >= MAX_FIXED) throw new Error(`Up to ${MAX_FIXED} fixed costs: remove one first.`);
  const f: FixedCost = { id: `f${++s.seq}`, label, usdPerMonth: cents(usd) };
  s.fixed = [...s.fixed, f];
  return f;
}

/** Sets (or, with an empty url, removes) a floor's feed; throws a plain reason. */
export function setFeed(s: EarningsState, repoId: string, url: string): EarningsFeed | null {
  const u = url.trim();
  if (!u) {
    s.feeds = s.feeds.filter((f) => f.repoId !== repoId);
    return null;
  }
  let p: URL;
  try {
    p = new URL(u);
  } catch {
    throw new Error('Give the feed as a full URL, e.g. https://clip.example.com/api/earnings.');
  }
  if (p.protocol !== 'https:' && !(p.protocol === 'http:' && (p.hostname === 'localhost' || p.hostname === '127.0.0.1'))) throw new Error('A feed goes over https (or http on localhost).');
  if (p.username || p.password) throw new Error('Leave sign-in out of the URL: an Access service token is added by the office.');
  const was = s.feeds.find((f) => f.repoId === repoId);
  const f: EarningsFeed = was?.url === u ? was : { repoId, url: u, status: 'pending', checkedAt: null, days: {} };
  s.feeds = [...s.feeds.filter((x) => x.repoId !== repoId), f];
  return f;
}

// ---------- the feed ----------

/** A day's total from a feed row: usd, amount or total, else the sum of its other numbers (payouts, revenue, invoices…). */
function rowUsd(r: Record<string, unknown>): number | null {
  for (const k of ['usd', 'amount', 'total', 'earnings']) {
    const v = money(r[k]);
    if (v !== null) return v;
  }
  const parts = Object.entries(r).filter(([k]) => k !== 'date' && k !== 'day').map(([, v]) => money(v)).filter((v): v is number => v !== null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

/**
 * A feed's answer as days, or why it has no data. Accepted: an array of { date, usd } (or amount / total, or parts
 * that add up), bare or under `days`, `earnings` or `data`. An unreachable feed, an error status or a body without one
 * day in it is "no data", never 0.
 */
export function readFeed(status: number, body: unknown): { days: Record<string, number> } | { error: string } {
  if (status === 0) return { error: "Couldn't reach the feed." };
  if (status < 200 || status >= 300) return { error: `The feed answered HTTP ${status}${status === 302 || status === 403 ? ' (Access refused the token)' : ''}.` };
  const b = obj(body);
  const rows = Array.isArray(body) ? body : [b.days, b.earnings, b.data].find(Array.isArray);
  if (!Array.isArray(rows)) return { error: 'The feed answered without a list of days.' };
  const days: Record<string, number> = {};
  for (const x of rows) {
    const r = obj(x);
    const date = isDay(r.date) ? r.date : isDay(r.day) ? r.day : null;
    const usd = rowUsd(r);
    if (date && usd !== null) days[date] = cents((days[date] ?? 0) + usd);
  }
  return Object.keys(days).length ? { days } : { error: 'The feed answered with no days in it.' };
}

/** Applies a read: good days replace the old ones (merged, so older days stay), a failure keeps them but says no data. */
export function applyFeedRead(f: EarningsFeed, read: ReturnType<typeof readFeed>, now: number): EarningsFeed {
  if ('error' in read) return { ...f, status: 'no-data', checkedAt: now, error: read.error };
  const { error: _e, ...rest } = f;
  return { ...rest, status: 'ok', checkedAt: now, days: { ...f.days, ...read.days } };
}

// ---------- spend ----------

/** Days older than what the card shows are dropped. */
export function pruneSpend(spend: Record<string, SpendDay>, now: number): Record<string, SpendDay> {
  const oldest = dayKey(now - KEEP_DAYS * DAY_MS);
  return Object.fromEntries(Object.entries(spend).filter(([d]) => d >= oldest));
}

/** A fixed cost's share of one day: a month's cost × 12 / 365. */
const fixedPerDay = (fixed: readonly FixedCost[]) => fixed.reduce((n, f) => n + (f.usdPerMonth * 12) / 365, 0);

// ---------- weeks ----------

/** Local midnight of the Monday of `ms`'s week. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** The YYYY-MM-DD of each day of the week starting at `start`, up to and including today. */
function weekDays(start: number, now: number): string[] {
  const today = dayKey(now);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const k = dayKey(d.getTime());
    if (k > today) break;
    out.push(k);
  }
  return out;
}

const sum = (r: Record<string, number> | undefined) => Object.values(r ?? {}).reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0);

/** The card: this week's earnings and spend, profit, 8 weeks, the split by floor and by cost type. */
export function earningsView(s: EarningsState, now: number): EarningsView {
  const perDay = fixedPerDay(s.fixed);
  const start = weekStart(now);
  const weekOf = (w: number) => {
    const d = new Date(start);
    d.setDate(d.getDate() - 7 * w);
    return d.getTime();
  };
  const tally = (days: string[]) => {
    const set = new Set(days);
    const floors = new Map<string, { earnings: number; spend: number; feedDays: boolean }>();
    const row = (id: string) => floors.get(id) ?? floors.set(id, { earnings: 0, spend: 0, feedDays: false }).get(id)!;
    const sources = new Map<string, number>();
    let claude = 0, providers = 0;
    for (const e of s.entries) {
      if (!set.has(e.date)) continue;
      row(e.repoId ?? '').earnings += e.usd;
      sources.set(e.source, (sources.get(e.source) ?? 0) + e.usd);
    }
    for (const f of s.feeds) {
      for (const [d, usd] of Object.entries(f.days)) {
        if (!set.has(d)) continue;
        const r = row(f.repoId);
        r.earnings += usd;
        r.feedDays = true;
        sources.set('Feed', (sources.get('Feed') ?? 0) + usd);
      }
    }
    for (const d of days) {
      const sp = s.spend[d];
      for (const [id, usd] of Object.entries(sp?.claude ?? {})) row(id).spend += usd;
      claude += sum(sp?.claude);
      providers += sum(sp?.providers);
    }
    const fixed = perDay * days.length;
    row('').spend += providers + fixed;
    const earnings = [...floors.values()].reduce((n, r) => n + r.earnings, 0);
    const spend = claude + providers + fixed;
    return { floors, sources, claude, providers, fixed, earnings, spend };
  };
  const weeks: EarningsWeek[] = [];
  let now7: ReturnType<typeof tally> | null = null;
  for (let w = EARNINGS_WEEKS - 1; w >= 0; w--) {
    const t = tally(weekDays(weekOf(w), now));
    if (w === 0) now7 = t;
    weeks.push({ start: dayKey(weekOf(w)), earnings: cents(t.earnings), spend: cents(t.spend), profit: cents(t.earnings - t.spend) });
  }
  const t = now7!;
  const noData = s.feeds.filter((f) => f.status === 'no-data').map((f) => f.repoId);
  for (const id of noData) if (!t.floors.has(id)) t.floors.set(id, { earnings: 0, spend: 0, feedDays: false });
  const byFloor: EarningsFloorRow[] = [...t.floors.entries()]
    .map(([id, r]) => ({ repoId: id || null, earnings: noData.includes(id) && !r.feedDays && r.earnings === 0 ? null : cents(r.earnings), spend: cents(r.spend) }))
    .sort((a, b) => (b.earnings ?? 0) - (a.earnings ?? 0) || b.spend - a.spend);
  const oldest = weeks[0].start;
  return {
    week: weeks[weeks.length - 1],
    weeks,
    byFloor,
    byType: [
      { type: 'claude', usd: cents(t.claude) },
      { type: 'providers', usd: cents(t.providers) },
      { type: 'fixed', usd: cents(t.fixed) },
    ],
    bySource: [...t.sources.entries()].map(([source, usd]) => ({ source, usd: cents(usd) })).sort((a, b) => b.usd - a.usd),
    noData,
    feeds: s.feeds.map(({ days: _d, ...f }) => f),
    entries: s.entries.filter((e) => e.date >= oldest).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at),
    fixed: s.fixed,
    fixedPerDay: cents(perDay),
  };
}

/** company_status's `earnings` block: the week the CEO plans against, small. */
export function earningsBlock(v: EarningsView, floorOf: (repoId: string) => number | null) {
  const prev = v.weeks[v.weeks.length - 2];
  return {
    weekEarnings: v.week.earnings,
    weekSpend: v.week.spend,
    profit: v.week.profit,
    lastWeekProfit: prev?.profit ?? null,
    ...(v.noData.length && { noData: v.noData.map((id) => `floor ${floorOf(id) ?? '?'}'s earnings feed is unreachable: its earnings are missing, not 0`) }),
  };
}
