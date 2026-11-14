// Earnings vs. spend (#666), the server's pure part: each day's spend rolled up from the cost ledger (it keeps 30 days;
// the rollup keeps 8 weeks) and from the providers that report what they cost. The card's rules are in shared/earnings.ts.
import { dayKey } from '../shared/journal.ts';
import { isCeoKind, type CostRecord } from '../shared/costs.ts';
import { pruneSpend, type SpendDay } from '../shared/earnings.ts';
import type { UsageSource } from '../shared/types.ts';
import { startOfDay } from './metrics.ts';

const LEDGER_DAYS = 29; // the days the ledger holds whole: older ones keep their rollup

/** Providers' own spend, per day: a 7-day report spread over a day. Coding accounts and Anthropic are the ledger's already. */
export function providerSpend(sources: readonly UsageSource[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sources) {
    if (s.category === 'coding' || s.provider === 'anthropic' || !s.spendUsd7d) continue;
    out[s.label] = Math.round((s.spendUsd7d / 7) * 100) / 100;
  }
  return out;
}

/**
 * The rollup brought up to date: every day the ledger holds whole (from its first line on) is recounted from it (Claude by floor, '' the CEO),
 * today's providers set from their latest report, and days past 8 weeks dropped.
 */
export function rollSpend(spend: Record<string, SpendDay>, records: readonly CostRecord[], providers: Record<string, number>, now: number): Record<string, SpendDay> {
  const first = new Date(now);
  first.setDate(first.getDate() - LEDGER_DAYS);
  const oldest = records.find((r) => r.type === 'session')?.at ?? now;
  const from = Math.max(startOfDay(first.getTime()), startOfDay(oldest)); // before the ledger's first line, the rollup stands
  const out: Record<string, SpendDay> = { ...spend };
  for (let d = new Date(from); d.getTime() <= now; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d.getTime());
    out[k] = { claude: {}, providers: out[k]?.providers ?? {} };
  }
  for (const r of records) {
    if (r.type !== 'session' || r.at < from) continue;
    const day = out[dayKey(r.at)];
    if (!day) continue;
    const id = isCeoKind(r.kind) ? '' : r.repoId;
    day.claude[id] = Math.round(((day.claude[id] ?? 0) + r.usd) * 10_000) / 10_000;
  }
  const today = dayKey(now);
  out[today] = { claude: out[today]?.claude ?? {}, providers };
  return pruneSpend(out, now);
}
