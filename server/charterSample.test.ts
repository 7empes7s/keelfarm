import { describe, expect, it } from 'vitest';
import { charterInsights } from '../shared/charterStats.ts';
import { sampleLog } from './charterSample.ts';
import { sampleCosts } from './costSample.ts';
import { demoCharter } from './demoCharters.ts';
import { seeded } from './journalSample.ts';

describe("the demo's objective log", () => {
  it('gives every number on the Charter tab something to show', () => {
    const now = Date.parse('2026-11-05T15:00:00Z');
    const rand = seeded(105);
    const agents = [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Linus' }];
    const ledger = sampleCosts([{ repoId: 'r', agents }], { id: 'ceo', name: 'Morgan' }, now, rand, 28);
    const { charter } = demoCharter('demo-co/pixel-todo');
    const log = sampleLog(charter, ledger, now, rand);
    const i = charterInsights({ log, charter, status: {}, ledger, issues: [], busy: new Set(), held: new Set(), now });
    const o1 = i.objectives[0];
    expect(o1.byWindow[7].prs.length).toBeGreaterThan(0);
    expect(o1.byWindow[7]).toMatchObject({ firstPass: expect.any(Number), rounds: expect.any(Number), leadMs: expect.any(Number) });
    expect(o1.byWindow[7].usd).toBeGreaterThan(0);
    expect(o1.weeks.every((n) => n > 0)).toBe(true);
    expect(i.objectives.at(-1)!.stalled).toBe(true);
    expect(i.byWindow[30].inFocus.share).toBeGreaterThan(0);
    expect(i.byWindow[30].untagged.length).toBeGreaterThan(0);
    expect(i.byWindow[30].standards!.some((s) => s.prs.length > 0)).toBe(true);
  });
});
