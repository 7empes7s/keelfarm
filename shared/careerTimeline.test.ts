import { describe, expect, it } from 'vitest';
import { careerTimeline, groupByDay, TIMELINE_DAYS, type TimelineItem } from './careerTimeline.ts';
import type { CostRecord } from './costs.ts';
import { historyId, type HistoryEntry } from './history.ts';

const NOW = Date.UTC(2026, 10, 7, 18);
const H = 3_600_000;
const R = 'repo-1';

function entry(e: Partial<HistoryEntry> & Pick<HistoryEntry, 'at' | 'agentId' | 'agent' | 'kind' | 'outcome'>): HistoryEntry {
  return { id: historyId(e.at, e.agentId, e.kind), startedAt: e.at - H / 2, repoId: R, repo: 'o/r', floor: 1, issue: null, pr: null, title: '', note: '', usd: 1, tokens: null, model: '', effort: '', sessionId: null, transcript: null, ...e };
}

describe("an agent's timeline (#205)", () => {
  const ada = { id: 'ada-2', name: 'Ada' };
  const entries: HistoryEntry[] = [
    entry({ at: NOW - 10 * H, agentId: 'ada-2', agent: 'Ada', kind: 'issue', outcome: 'pr', issue: 5, pr: 50, title: 'Dark mode' }),
    entry({ at: NOW - 9 * H, agentId: 'bob', agent: 'Bob', kind: 'qa', outcome: 'qa-fail', pr: 50 }),
    entry({ at: NOW - 8 * H, agentId: 'ada-2', agent: 'Ada', kind: 'fix-qa', outcome: 'commit', pr: 50, usd: 0.5 }),
    entry({ at: NOW - 7 * H, agentId: 'bob', agent: 'Bob', kind: 'qa', outcome: 'qa-pass', pr: 50 }),
    entry({ at: NOW - 6 * H, agentId: '', agent: 'The office', kind: 'merge', outcome: 'merged', pr: 50, usd: 0 }),
    entry({ at: NOW - 5 * H, agentId: 'ada-2', agent: 'Ada', kind: 'qa', outcome: 'qa-pass', pr: 61, title: 'Retry webhooks' }),
    entry({ at: NOW - 4 * H, agentId: 'ada-2', agent: 'Ada', kind: 'fix-conflict', outcome: 'commit', pr: 62 }),
    entry({ at: NOW - 3 * H, agentId: 'ada-2', agent: 'Ada', kind: 'issue', outcome: 'watchdog', issue: 7, note: 'went quiet' }),
    // from before her rehire, under her old id
    entry({ at: NOW - 30 * H, agentId: 'ada-1', agent: 'Ada', kind: 'issue', outcome: 'no-pr', issue: 4 }),
    // someone else's work, and the office's merge of another PR
    entry({ at: NOW - 2 * H, agentId: 'bob', agent: 'Bob', kind: 'issue', outcome: 'pr', pr: 70 }),
    entry({ at: NOW - H, agentId: '', agent: 'The office', kind: 'merge', outcome: 'merged', pr: 70 }),
    // too old
    entry({ at: NOW - (TIMELINE_DAYS + 1) * 24 * H, agentId: 'ada-1', agent: 'Ada', kind: 'issue', outcome: 'pr', pr: 1 }),
  ];
  const costs: CostRecord[] = [{ type: 'session', at: NOW - 9 * H, ms: 1, repoId: R, agentId: 'bob', agent: 'Bob', kind: 'qa', issue: null, pr: 50, round: 1, cause: 'bug', model: '', effort: '', usd: 1, tokens: null, outcome: 'qa-fail' }];

  it('puts each build with its QA rounds, fixes and merge; reviews, other fixes, stops and rehires apart, newest first', () => {
    const t = careerTimeline({ entries, costs, agent: ada, rehired: [NOW - 20 * H], now: NOW });
    expect(t.cut).toBe(false);
    expect(t.items.map((i) => i.type)).toEqual(['stop', 'fix', 'review', 'build', 'rehired', 'build']);
    const build = t.items[3] as Extract<TimelineItem, { type: 'build' }>;
    expect(build).toMatchObject({ issue: 5, pr: 50, title: 'Dark mode', state: 'merged', fixes: 1, usd: 1.5, at: NOW - 6 * H, ms: H });
    expect(build.rounds.map((r) => [r.pass, r.by, r.cause])).toEqual([
      [false, 'Bob', 'bug'],
      [true, 'Bob', null],
    ]);
    expect(t.items[0]).toMatchObject({ type: 'stop', outcome: 'watchdog', note: 'went quiet' }); // no PR: no build item for it
    expect(t.items[1]).toMatchObject({ type: 'fix', why: 'conflict', pr: 62 });
    expect(t.items[2]).toMatchObject({ type: 'review', pass: true, pr: 61 });
    expect(t.items[5]).toMatchObject({ type: 'build', state: 'no-pr', issue: 4 });
  });

  it('groups by day, newest day first, each with what it cost', () => {
    const day = (at: number) => new Date(at).toISOString().slice(0, 10);
    const items: TimelineItem[] = careerTimeline({ entries, costs, agent: ada, rehired: [NOW - 20 * H], now: NOW }).items;
    const days = groupByDay(items, day);
    expect(days.map((d) => [d.day, d.items.map((i) => i.type), d.usd])).toEqual([
      ['2026-11-07', ['stop', 'fix', 'review', 'build'], 4.5],
      ['2026-11-06', ['rehired', 'build'], 1],
    ]);
    expect(groupByDay([], day)).toEqual([]);
  });
});
