// The floor themes' live numbers (#370), pure: the trading floor's ticker (the floor's own throughput as "stocks",
// each arrow against the value the ticker showed last), its candlesticks (merges per hour), the market light that
// follows office hours and the world clocks; and the game studio's build bar over the floor's open PRs.

import type { OpsNumbers, PrStage } from '../../../../shared/ops';

export interface Quote {
  symbol: string;
  text: string;
  /** Against the value before: up, down or unchanged. */
  dir: 'up' | 'down' | 'flat';
  /** Whether that move is good news (green) or bad (red): fewer open PRs or a cheaper merge is good. */
  good: boolean;
}

/** The numbers a quote moves with, kept by the caller between renders. */
export type QuoteValues = Record<string, number | null>;

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const usd = (v: number | null) => (v === null ? '—' : `$${v.toFixed(2)}`);

/** The floor's numbers as ticker symbols, and their values for the next call's arrows. */
export function tickerQuotes(n: OpsNumbers, openPrs: number, prev: QuoteValues = {}): { quotes: Quote[]; values: QuoteValues } {
  const costPerMerge = n.mergedToday > 0 ? n.costToday / n.mergedToday : null;
  const rows: { symbol: string; value: number | null; text: string; upIsGood: boolean; start?: Quote['dir'] }[] = [
    { symbol: 'MRG', value: n.mergedToday, text: `${n.mergedToday} today`, upIsGood: true, start: n.mergedHour > 0 ? 'up' : 'flat' },
    { symbol: 'QA', value: n.qaPass, text: pct(n.qaPass), upIsGood: true },
    { symbol: 'CPM', value: costPerMerge, text: usd(costPerMerge), upIsGood: false },
    { symbol: 'OPEN', value: openPrs, text: `${openPrs} PRs`, upIsGood: false },
    { symbol: 'CI', value: n.ciPass, text: pct(n.ciPass), upIsGood: true },
    { symbol: 'SHIP', value: n.mergedHour, text: `${n.mergedHour}/h`, upIsGood: true },
  ];
  const values: QuoteValues = {};
  const quotes = rows.map((r) => {
    values[r.symbol] = r.value;
    const before = prev[r.symbol];
    let dir: Quote['dir'] = r.start ?? 'flat';
    if (before !== undefined && before !== null && r.value !== null) dir = r.value > before ? 'up' : r.value < before ? 'down' : 'flat';
    return { symbol: r.symbol, text: r.text, dir, good: dir === 'flat' || (dir === 'up') === r.upIsGood };
  });
  return { quotes, values };
}

export interface Candle {
  open: number;
  close: number;
  high: number;
  low: number;
}

/** Merges per hour (oldest first) as a price: each merge lifts it, an hour without one lets it slip. */
export function candles(spark: readonly number[], start = 100): Candle[] {
  let price = start;
  return spark.map((m) => {
    const open = price;
    const close = open + (m > 0 ? 3 * m : -1);
    price = close;
    return { open, close, high: Math.max(open, close) + 0.6, low: Math.min(open, close) - 0.6 };
  });
}

/** The market light: open on weekdays (1-5) from 9:30 to 16:00 office time. `hour` is 0-24, fractional. */
export const marketOpen = (hour: number, weekday: number) => weekday >= 1 && weekday <= 5 && hour >= 9.5 && hour < 16;

const CLOCK_CITIES: { city: string; zone: string | null }[] = [
  { city: 'NEW YORK', zone: 'America/New_York' },
  { city: 'LONDON', zone: 'Europe/London' },
  { city: 'TOKYO', zone: 'Asia/Tokyo' },
  { city: 'HERE', zone: null },
];

/** Hours and minutes in each clock's city at `now` (the viewer's own for HERE). */
export function worldClocks(now: Date): { city: string; h: number; m: number }[] {
  return CLOCK_CITIES.map(({ city, zone }) => {
    if (!zone) return { city, h: now.getHours(), m: now.getMinutes() };
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return { city, h: get('hour'), m: get('minute') };
  });
}

const STAGE_DONE: Record<PrStage, number> = { inQa: 0.55, fixing: 0.35, triage: 0.3, needsYou: 0.4, toMerge: 0.9 };

/** The Playtest screen's build bar: how far the floor's open PRs are on their way to merging, 0-1, and a caption. */
export function buildProgress(stages: readonly PrStage[]): { done: number; caption: string } {
  if (!stages.length) return { done: 1, caption: 'build is clean · no open PRs' };
  const done = stages.reduce((s, st) => s + STAGE_DONE[st], 0) / stages.length;
  const ready = stages.filter((s) => s === 'toMerge').length;
  return { done, caption: `${stages.length} PR${stages.length === 1 ? '' : 's'} in the build · ${ready} ready to ship` };
}

/** The newsroom's TVs (#570): the floor's news, merges first, then PRs in review and the issues being worked out. */
export function headlines(pulls: readonly { title: string; state: string }[], issues: readonly { title: string }[], max = 5): string[] {
  const out = [
    ...pulls.filter((p) => p.state === 'MERGED').map((p) => `Shipped: ${p.title}`),
    ...pulls.filter((p) => p.state === 'OPEN').map((p) => `In review: ${p.title}`),
    ...issues.map((i) => `Developing: ${i.title}`),
  ].slice(0, max);
  return out.length ? out : ['No news is good news'];
}
