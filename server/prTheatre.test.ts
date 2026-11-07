import { describe, expect, it } from 'vitest';
import { clampMainIdleMin, clampRecentHours, closedPrs, expired, freeSlot, leftoverPrDesks, mainExpired, onScreen, pickEviction, prBranch, prKey, prPortCandidates, prSlug, stopsAt, type PrRunInfo } from './prTheatre.ts';

const run = (pr: number, over: Partial<PrRunInfo> = {}): PrRunInfo => ({ key: prKey('o/r', pr), repoId: 'o/r', pr, slot: 1, active: true, viewedAt: 0, ...over });

describe('PR preview slots, folders and ports', () => {
  it('names a worktree and branch per slot, apart from the floor preview', () => {
    expect(prSlug(1)).toBe('preview-pr-1');
    expect(prBranch(2)).toBe('swarm-preview-pr-2');
    expect(prSlug(1)).not.toBe('preview');
    expect(prKey('o/r', 7)).toBe('o/r#7');
  });

  it('gives each slot its own lane in the hundred above the floor previews', () => {
    const one = prPortCandidates(6300, 1);
    const two = prPortCandidates(6300, 2);
    expect(one.slice(0, 3)).toEqual([6401, 6403, 6405]);
    expect(two.slice(0, 3)).toEqual([6402, 6404, 6406]);
    for (const p of [...one, ...two]) expect(p >= 6400 && p < 6500).toBe(true);
    expect(one.some((p) => two.includes(p))).toBe(false);
    expect(prPortCandidates(7300, 1)[0]).toBe(7401);
  });

  it('hands out the lowest free slot, none when full', () => {
    expect(freeSlot([])).toBe(1);
    expect(freeSlot([{ slot: 1 }])).toBe(2);
    expect(freeSlot([{ slot: 2 }])).toBe(1);
    expect(freeSlot([{ slot: 1 }, { slot: 2 }])).toBeNull();
  });
});

describe('what is on screen', () => {
  it("counts each viewer's latest word while it is recent", () => {
    const now = 100_000;
    const screen = onScreen(
      [
        { key: 'o/r#1', at: now - 10_000 },
        { key: 'o/r#2', at: now - 80_000 },
        { key: null, at: now },
      ],
      now,
      75_000,
    );
    expect([...screen]).toEqual(['o/r#1']);
  });
});

describe('making room for a new PR preview', () => {
  it('stops the one unwatched the longest', () => {
    expect(pickEviction([run(1, { viewedAt: 500 }), run(2, { viewedAt: 100, slot: 2 })], new Set())).toBe('o/r#2');
  });

  it('never stops one that is on screen', () => {
    const runs = [run(1, { viewedAt: 500 }), run(2, { viewedAt: 100, slot: 2 })];
    expect(pickEviction(runs, new Set(['o/r#2']))).toBe('o/r#1');
    expect(pickEviction(runs, new Set(['o/r#1', 'o/r#2']))).toBeNull();
  });

  it('drops a failed one before a running one', () => {
    expect(pickEviction([run(1, { viewedAt: 100 }), run(2, { viewedAt: 900, active: false, slot: 2 })], new Set())).toBe('o/r#2');
  });
});

describe('stopping on its own', () => {
  it('stops previews nobody has watched for the idle time', () => {
    const now = 30 * 60_000;
    const runs = [run(1, { viewedAt: now - 21 * 60_000 }), run(2, { viewedAt: now - 5 * 60_000 }), run(3, { viewedAt: 0 })];
    expect(expired(runs, new Set(), now, 20 * 60_000)).toEqual(['o/r#1', 'o/r#3']);
    expect(expired(runs, new Set(['o/r#3']), now, 20 * 60_000)).toEqual(['o/r#1']);
  });

  it('stops previews whose PR merged, closed or left the list', () => {
    const runs = [run(1), run(2), run(3), run(4), run(5, { repoId: 'o/other', key: prKey('o/other', 5) })];
    const pulls = [
      { number: 1, state: 'OPEN' },
      { number: 2, state: 'MERGED' },
      { number: 3, state: 'CLOSED' },
    ];
    expect(closedPrs(runs, 'o/r', pulls)).toEqual(['o/r#2', 'o/r#3', 'o/r#4']);
  });

  it("keeps a missing PR when the open list was cut off at its limit", () => {
    const pulls = Array.from({ length: 50 }, (_, i) => ({ number: 100 + i, state: 'OPEN' }));
    expect(closedPrs([run(4)], 'o/r', pulls)).toEqual([]);
  });
});

describe('previews in use, the main preview and leftovers (#204)', () => {
  it('never evicts or idles out a preview an agent is testing in', () => {
    const runs = [run(1, { viewedAt: 100, held: true }), run(2, { viewedAt: 900, slot: 2 })];
    expect(pickEviction(runs, new Set())).toBe('o/r#2');
    expect(pickEviction(runs, new Set(['o/r#2']))).toBeNull();
    expect(expired(runs, new Set(), 60 * 60_000, 20 * 60_000)).toEqual(['o/r#2']);
  });

  it('stops the main preview after its idle time, never while watched, held, stopped or with the stop off', () => {
    const idle = 30 * 60_000;
    const x = { active: true, viewedAt: 0, watched: false, held: false };
    expect(mainExpired(x, idle - 1, idle)).toBe(false);
    expect(mainExpired(x, idle, idle)).toBe(true);
    expect(mainExpired({ ...x, watched: true }, idle * 2, idle)).toBe(false);
    expect(mainExpired({ ...x, held: true }, idle * 2, idle)).toBe(false);
    expect(mainExpired({ ...x, active: false }, idle * 2, idle)).toBe(false);
    expect(mainExpired(x, idle * 99, 0)).toBe(false);
  });

  it("says when an unwatched preview will stop", () => {
    expect(stopsAt({ active: true, viewedAt: 1000, watched: false, held: false }, 60_000)).toBe(61_000);
    expect(stopsAt({ active: true, viewedAt: 1000, watched: true, held: false }, 60_000)).toBeNull();
    expect(stopsAt({ active: true, viewedAt: 1000, watched: false, held: true }, 60_000)).toBeNull();
  });

  it('picks the PR slot desks no preview runs from, never the main one or a stray folder', () => {
    expect(leftoverPrDesks(['preview', 'preview-pr-1', 'preview-pr-2', 'ada', 'preview-pr-x'], ['preview-pr-1'])).toEqual(['preview-pr-2']);
  });

  it('keeps the settings in range', () => {
    expect([clampRecentHours(0), clampRecentHours('x'), clampRecentHours(72)]).toEqual([1, 48, 72]);
    expect([clampMainIdleMin(-5), clampMainIdleMin(undefined), clampMainIdleMin(0), clampMainIdleMin(45)]).toEqual([0, 30, 0, 45]);
  });
});
