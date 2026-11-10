// Who spent the usage meter's window (#334): each floor's and the CEO's share of the office's own spend from the cost
// ledger, over each bar's window (the week since its last reset, the last 5 hours). Only the office's sessions are in
// the ledger, so these are shares of the office's spend, not of the plan's %.

import { isCeoKind, type CostRecord, type CostSession } from './costs.ts';
import type { UsageReading, UsageShares } from './types.ts';

const HOUR_MS = 3_600_000;
const ROWS = 4;

/** How long a limit's window is: five hours, else a week. */
const windowMs = (type: string) => (type === 'five_hour' ? 5 : 7 * 24) * HOUR_MS;

/**
 * When a bar's window began: at its reset once that has passed, else a week before the coming weekly reset, else
 * (the 5-hour bar, no reset time, or one that makes no sense) the window's length ago. Never more than one window back.
 */
export function windowSince(r: Pick<UsageReading, 'type' | 'resetsAt'>, now: number): number {
  const len = windowMs(r.type);
  const start = r.resetsAt === null ? now - len : r.resetsAt <= now ? r.resetsAt : r.type === 'five_hour' ? now - len : r.resetsAt - len;
  return start > now ? now - len : Math.max(now - len, start);
}

/** Whether a session spent the built-in Claude login's plan, the one the meter reads (as shared/accounts.ts's accountSpend counts it). */
const onPlan = (s: CostSession) => !s.account || s.account === 'claude-login';

/** The per-model weekly limits count only that model's sessions. */
const forLimit = (type: string, model: string) => (type === 'seven_day_opus' ? /opus/i.test(model) : type === 'seven_day_sonnet' ? /sonnet/i.test(model) : true);

/** Whole percentages that add up to 100 (largest remainder), in `usd`'s order. */
function percents(usd: number[], total: number): number[] {
  const raw = usd.map((u) => (u / total) * 100);
  const pct = raw.map(Math.floor);
  let left = 100 - pct.reduce((n, p) => n + p, 0);
  for (const i of raw.map((_, i) => i).sort((a, b) => raw[b] - pct[b] - (raw[a] - pct[a]))) {
    if (left-- <= 0) break;
    pct[i]++;
  }
  return pct;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** One bar's shares: the floors and the CEO ('') by spend in its window, the biggest four, then the rest as others. */
export function windowShares(records: readonly CostRecord[], r: Pick<UsageReading, 'type' | 'resetsAt'>, now: number): UsageShares {
  const since = windowSince(r, now);
  const by = new Map<string, number>();
  for (const s of records) {
    if (s.type !== 'session' || s.at < since || s.at > now || !(s.usd > 0) || !onPlan(s) || !forLimit(r.type, s.model)) continue;
    const row = isCeoKind(s.kind) ? '' : s.repoId;
    by.set(row, (by.get(row) ?? 0) + s.usd);
  }
  const sorted = [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const usd = sorted.reduce((n, [, u]) => n + u, 0);
  if (!usd) return { type: r.type, since, usd: 0, rows: [], others: null };
  const top = sorted.slice(0, ROWS);
  const rest = sorted.slice(ROWS);
  const restUsd = rest.reduce((n, [, u]) => n + u, 0);
  const pct = percents([...top.map(([, u]) => u), ...(rest.length ? [restUsd] : [])], usd);
  return {
    type: r.type,
    since,
    usd: cents(usd),
    rows: top.map(([repoId, u], i) => ({ repoId, usd: cents(u), pct: pct[i] })),
    others: rest.length ? { count: rest.length, usd: cents(restUsd), pct: pct[top.length] } : null,
  };
}

/** What a tab would see change: each bar's rows and whole percentages (the dollars move with every session, so not them). */
export const sharesSignature = (shares: readonly UsageShares[]) => shares.map((s) => `${s.type}:${s.rows.map((r) => `${r.repoId}=${r.pct}`).join(',')}${s.others ? `,+${s.others.count}=${s.others.pct}` : ''}`).join('|');

/** Every bar's shares, one per reading. */
export const usageShares = (records: readonly CostRecord[], readings: readonly UsageReading[], now: number): UsageShares[] => readings.map((r) => windowShares(records, r, now));
