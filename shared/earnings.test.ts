import { describe, expect, it } from 'vitest';
import { addEntry, addFixed, applyFeedRead, earningsBlock, earningsView, emptyEarnings, loadEarnings, readFeed, setFeed, weekStart, type EarningsState } from './earnings.ts';
import { dayKey } from './journal.ts';

// Earnings vs. spend (#666).

// Thursday 12 November 2026, noon local: this week is Monday 9 to Sunday 15, with 4 days so far.
const NOW = new Date(2026, 10, 12, 12).getTime();
const day = (d: number) => dayKey(new Date(2026, 10, d, 12).getTime());

function state(): EarningsState {
  const s = emptyEarnings();
  s.spend[day(9)] = { claude: { r1: 10, '': 2 }, providers: { ElevenLabs: 1 } };
  s.spend[day(12)] = { claude: { r1: 5 }, providers: {} };
  s.spend[day(8)] = { claude: { r1: 100 }, providers: {} }; // last week's Sunday
  return s;
}

describe('weeks', () => {
  it('start on Monday', () => {
    expect(dayKey(weekStart(NOW))).toBe(day(9));
    expect(dayKey(weekStart(new Date(2026, 10, 15, 23).getTime()))).toBe(day(9));
    expect(dayKey(weekStart(new Date(2026, 10, 16, 1).getTime()))).toBe(day(16));
  });
});

describe('earningsView', () => {
  it("adds up this week's earnings, spend with fixed costs spread per day so far, and the profit", () => {
    const s = state();
    addFixed(s, { label: 'Server', usdPerMonth: 365 / 12 }); // $1 a day
    addEntry(s, { date: day(10), usd: 50, source: 'Sponsor', repoId: 'r1' }, NOW);
    addEntry(s, { date: day(2), usd: 999, source: 'Old', repoId: null }, NOW); // another week
    setFeed(s, 'r2', 'https://clip.example.com/api/earnings');
    s.feeds[0] = applyFeedRead(s.feeds[0], readFeed(200, { days: [{ date: day(11), usd: 30 }, { date: day(1), usd: 7 }] }), NOW);
    const v = earningsView(s, NOW);
    // spend: claude 17 + providers 1 + fixed 4 days × $1 = 22; earnings: 50 + 30
    expect(v.week).toEqual({ start: day(9), earnings: 80, spend: 22, profit: 58 });
    expect(v.byType).toEqual([
      { type: 'claude', usd: 17 },
      { type: 'providers', usd: 1 },
      { type: 'fixed', usd: 4 },
    ]);
    expect(v.byFloor).toEqual([
      { repoId: 'r1', earnings: 50, spend: 15 },
      { repoId: 'r2', earnings: 30, spend: 0 },
      { repoId: null, earnings: 0, spend: 7 }, // the CEO, providers and fixed costs
    ]);
    expect(v.bySource).toEqual([{ source: 'Sponsor', usd: 50 }, { source: 'Feed', usd: 30 }]);
    expect(v.fixedPerDay).toBe(1);
  });

  it('gives 8 weeks, oldest first, each with every day of fixed costs', () => {
    const s = state();
    addFixed(s, { label: 'Server', usdPerMonth: 365 / 12 });
    const v = earningsView(s, NOW);
    expect(v.weeks).toHaveLength(8);
    expect(v.weeks[7].start).toBe(day(9));
    expect(v.weeks[6]).toEqual({ start: day(2), earnings: 0, spend: 107, profit: -107 }); // 100 + 7 days × $1
    expect(v.weeks[0]).toEqual({ start: dayKey(new Date(2026, 8, 21, 12).getTime()), earnings: 0, spend: 7, profit: -7 });
  });

  it("an unreachable feed's floor shows no data, never 0, and the CEO's block says so", () => {
    const s = state();
    setFeed(s, 'r2', 'https://clip.example.com/api/earnings');
    s.feeds[0] = applyFeedRead(s.feeds[0], readFeed(0, undefined), NOW);
    const v = earningsView(s, NOW);
    expect(v.noData).toEqual(['r2']);
    expect(v.byFloor.find((f) => f.repoId === 'r2')?.earnings).toBeNull();
    expect(earningsBlock(v, () => 4)).toEqual({ weekEarnings: 0, weekSpend: 18, profit: -18, lastWeekProfit: -100, noData: ["floor 4's earnings feed is unreachable: its earnings are missing, not 0"] });
  });
});

describe('readFeed', () => {
  it('reads days in the shapes a dashboard may answer', () => {
    expect(readFeed(200, [{ date: '2026-11-10', usd: 12.5 }])).toEqual({ days: { '2026-11-10': 12.5 } });
    expect(readFeed(200, { earnings: [{ day: '2026-11-10', amount: '4' }, { day: '2026-11-10', amount: 1 }] })).toEqual({ days: { '2026-11-10': 5 } });
    expect(readFeed(200, { data: [{ date: '2026-11-10', campaignPayouts: 10, platformRevenue: 2.5, creatorInvoices: 0 }] })).toEqual({ days: { '2026-11-10': 12.5 } });
  });

  it('is "no data" when the feed is unreachable, refuses or says nothing, never 0', () => {
    expect(readFeed(0, undefined)).toEqual({ error: "Couldn't reach the feed." });
    expect(readFeed(403, {})).toEqual({ error: 'The feed answered HTTP 403 (Access refused the token).' });
    expect(readFeed(500, { days: [{ date: '2026-11-10', usd: 1 }] })).toHaveProperty('error');
    expect(readFeed(200, '<html>sign in</html>')).toEqual({ error: 'The feed answered without a list of days.' });
    expect(readFeed(200, { days: [{ date: 'yesterday', usd: 3 }] })).toEqual({ error: 'The feed answered with no days in it.' });
  });

  it('keeps the days it read before a failure, marked no data', () => {
    const s = emptyEarnings();
    const f = setFeed(s, 'r1', 'https://clip.example.com/api/earnings')!;
    expect(f.status).toBe('pending');
    const ok = applyFeedRead(f, readFeed(200, [{ date: '2026-11-10', usd: 3 }]), 1);
    const down = applyFeedRead(ok, readFeed(0, undefined), 2);
    expect(down).toMatchObject({ status: 'no-data', checkedAt: 2, days: { '2026-11-10': 3 } });
    expect(applyFeedRead(down, readFeed(200, [{ date: '2026-11-11', usd: 4 }]), 3)).toEqual({ repoId: 'r1', url: f.url, status: 'ok', checkedAt: 3, days: { '2026-11-10': 3, '2026-11-11': 4 } });
  });
});

describe('edits', () => {
  it('adds manual entries, today when no date is given, and refuses bad ones', () => {
    const s = emptyEarnings();
    expect(addEntry(s, { usd: '120.456', source: ' Sponsor ', note: 'Slot' }, NOW)).toEqual({ id: 'e1', date: day(12), usd: 120.46, source: 'Sponsor', note: 'Slot', repoId: null, at: NOW });
    expect(addEntry(s, { date: '2026-11-01', usd: -20, source: 'Refund', repoId: 'r1' }, NOW)).toMatchObject({ id: 'e2', usd: -20, repoId: 'r1' });
    expect(s.entries.map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(() => addEntry(s, { usd: 5, source: 'x', date: '11/01/2026' }, NOW)).toThrow('YYYY-MM-DD');
    expect(() => addEntry(s, { usd: 'lots', source: 'x' }, NOW)).toThrow('amount');
    expect(() => addEntry(s, { usd: 5, source: '  ' }, NOW)).toThrow('where the money came from');
  });

  it('checks fixed costs and feed URLs', () => {
    const s = emptyEarnings();
    expect(() => addFixed(s, { label: 'Server', usdPerMonth: 0 })).toThrow('monthly cost');
    expect(() => setFeed(s, 'r1', 'ftp://x')).toThrow('https');
    expect(() => setFeed(s, 'r1', 'https://u:p@x.com/f')).toThrow('sign-in');
    setFeed(s, 'r1', 'https://x.com/f');
    expect(setFeed(s, 'r1', '')).toBeNull();
    expect(s.feeds).toEqual([]);
  });

  it('loads what was saved and drops what is malformed', () => {
    const s = emptyEarnings();
    addEntry(s, { usd: 5, source: 'x' }, NOW);
    const back = loadEarnings(JSON.parse(JSON.stringify({ ...s, entries: [...s.entries, { id: 'bad' }] })));
    expect(back.entries).toEqual(s.entries);
    expect(loadEarnings(undefined)).toEqual(emptyEarnings());
  });
});
