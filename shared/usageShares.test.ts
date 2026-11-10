import { describe, expect, it } from 'vitest';
import type { CostRecord, CostSession, TaskKind } from './costs.ts';
import { usageShares, windowShares, windowSince } from './usageShares.ts';

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 7, 12);
const s = (repoId: string, usd: number, hoursAgo: number, kind: TaskKind = 'issue', more: Partial<CostSession> = {}): CostRecord => ({
  type: 'session', at: NOW - hoursAgo * H, ms: 60_000, repoId, agentId: 'a', agent: 'Ada', kind, issue: 1, pr: null, round: null,
  model: 'claude-opus-5-5', effort: '', usd, tokens: null, outcome: 'commit', ...more,
});
const week = { type: 'seven_day', resetsAt: NOW + 48 * H };
const fiveHour = { type: 'five_hour', resetsAt: NOW + 2 * H };

describe('windowSince', () => {
  it('starts the week a week before its next reset, else 7 days back; the 5-hour bar 5 hours back', () => {
    expect(windowSince(week, NOW)).toBe(NOW - 5 * 24 * H);
    expect(windowSince({ type: 'seven_day', resetsAt: null }, NOW)).toBe(NOW - 7 * 24 * H);
    expect(windowSince(fiveHour, NOW)).toBe(NOW - 5 * H);
  });
  it('starts at a reset that has passed, never more than one window back', () => {
    expect(windowSince({ type: 'seven_day', resetsAt: NOW - H }, NOW)).toBe(NOW - H);
    expect(windowSince({ type: 'seven_day', resetsAt: NOW - 30 * 24 * H }, NOW)).toBe(NOW - 7 * 24 * H);
    expect(windowSince({ type: 'seven_day', resetsAt: NOW + 30 * 24 * H }, NOW)).toBe(NOW - 7 * 24 * H);
  });
});

describe('windowShares', () => {
  // keelfarm busy all week, keel some, demo one old expensive session.
  const ledger: CostRecord[] = [
    ...Array.from({ length: 50 }, (_, i) => s('keelfarm', 4, i * 2)),
    ...Array.from({ length: 10 }, (_, i) => s('keel', 5, i * 10)),
    s('demo', 120, 7 * 24 + 5), // before the week: outside every window
    s('demo', 2, 100),
    s('', 6, 1, 'ceo-chat'),
    s('keel', 3, 1, 'ceo-triage'), // a CEO job about a floor counts as the CEO's
    { type: 'merge', at: NOW - H, repoId: 'keelfarm', pr: 9, issues: [1] },
  ];

  it('shares the weekly window by floor with the CEO its own row, biggest first, summing to 100%', () => {
    const w = windowShares(ledger, week, NOW);
    expect(w.rows.map((r) => r.repoId)).toEqual(['keelfarm', 'keel', '', 'demo']);
    expect(w.rows.map((r) => r.usd)).toEqual([200, 50, 9, 2]);
    expect(w.usd).toBe(261);
    expect(w.rows.reduce((n, r) => n + r.pct, 0)).toBe(100);
    expect(w.rows[0].pct).toBe(77);
    expect(w.others).toBeNull();
  });

  it('ignores sessions outside the window: one stale expensive session does not dominate', () => {
    const w = windowShares([s('demo', 500, 8 * 24), s('keelfarm', 4, 1), s('keelfarm', 4, 3)], week, NOW);
    expect(w.rows).toEqual([{ repoId: 'keelfarm', usd: 8, pct: 100 }]);
  });

  it('counts only the last 5 hours on the 5-hour bar', () => {
    const w = windowShares(ledger, fiveHour, NOW);
    expect(w.since).toBe(NOW - 5 * H);
    expect(w.rows).toEqual([
      { repoId: 'keelfarm', usd: 12, pct: 46 },
      { repoId: '', usd: 9, pct: 35 },
      { repoId: 'keel', usd: 5, pct: 19 },
    ]);
  });

  it('keeps four rows and sums the rest as others, still 100%', () => {
    const w = windowShares(['a', 'b', 'c', 'd', 'e', 'f'].map((r, i) => s(r, 1 + i, 1)), week, NOW);
    expect(w.rows.map((r) => r.repoId)).toEqual(['f', 'e', 'd', 'c']);
    expect(w.others).toEqual({ count: 2, usd: 3, pct: 14 });
    expect(w.rows.reduce((n, r) => n + r.pct, 0) + w.others!.pct).toBe(100);
  });

  it('rounds to whole percentages that still add to 100', () => {
    const w = windowShares([s('a', 1, 1), s('b', 1, 1), s('c', 1, 1)], week, NOW);
    expect(w.rows.map((r) => r.pct).sort((a, b) => a - b)).toEqual([33, 33, 34]);
  });

  it("leaves out other accounts' sessions and, on a per-model limit, other models", () => {
    const l = [s('a', 1, 1), s('b', 5, 1, 'issue', { account: 'claude-x1y2z3' }), s('c', 2, 1, 'issue', { account: 'claude-login', model: 'claude-sonnet-5' })];
    expect(windowShares(l, week, NOW).rows.map((r) => r.repoId)).toEqual(['c', 'a']);
    expect(windowShares(l, { type: 'seven_day_sonnet', resetsAt: null }, NOW).rows.map((r) => r.repoId)).toEqual(['c']);
  });

  it('is empty without spend, and gives one per reading', () => {
    expect(windowShares([], week, NOW)).toEqual({ type: 'seven_day', since: NOW - 5 * 24 * H, usd: 0, rows: [], others: null });
    const all = usageShares(ledger, [{ ...fiveHour, pct: 40, at: NOW }, { ...week, pct: 93, at: NOW }], NOW);
    expect(all.map((x) => x.type)).toEqual(['five_hour', 'seven_day']);
  });
});
