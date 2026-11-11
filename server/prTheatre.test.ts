import { describe, expect, it } from 'vitest';
import { addFreed, clampMainIdleMin, clampMaxLifeHours, clampRecentHours, closedPrs, freeSlot, leftoverPrDesks, lifeEndsAt, lifeWarning, onScreen, pickEviction, prBranch, previewSettings, prKey, prPortCandidates, prSlug, stopsAt, stopWhy, upgradePreviewIdle, type PreviewUse, type PrRunInfo } from './prTheatre.ts';
import { OPEN_PULLS_LISTED } from '../shared/types.ts';

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

const use = (over: Partial<PreviewUse> = {}): PreviewUse => ({ active: true, viewedAt: 0, inUse: false, held: false, pinnedUntil: null, lifeFrom: 0, ...over });
const MIN = 60_000;
const rules = { idleMs: MIN, maxLifeMs: 0 };

describe('stopping on its own', () => {
  it('stops 60 s after the last use of any kind', () => {
    expect(stopWhy(use({ viewedAt: 1000 }), rules, 1000 + MIN - 1)).toBeNull();
    expect(stopWhy(use({ viewedAt: 1000 }), rules, 1000 + MIN)).toBe('idle');
    expect(stopsAt(use({ viewedAt: 1000 }), rules, 0)).toBe(1000 + MIN);
  });

  it('never sooner than the grace after the last use, whatever the setting says', () => {
    expect(stopsAt(use(), { idleMs: 1000, maxLifeMs: 0 }, 0)).toBe(MIN);
  });

  it('never while in use, held, kept (📌) or not running, and never with the idle stop at 0', () => {
    const late = 99 * MIN;
    expect(stopWhy(use({ inUse: true }), rules, late)).toBeNull();
    expect(stopWhy(use({ held: true }), rules, late)).toBeNull();
    expect(stopWhy(use({ active: false }), rules, late)).toBeNull();
    expect(stopWhy(use(), { idleMs: 0, maxLifeMs: 0 }, late)).toBeNull();
    expect(stopWhy(use({ pinnedUntil: Infinity }), rules, late)).toBeNull();
    // An hour's pin runs out by itself.
    expect(stopWhy(use({ pinnedUntil: late + 1 }), rules, late)).toBeNull();
    expect(stopWhy(use({ pinnedUntil: late }), rules, late)).toBe('idle');
  });

  it('stops at its max lifetime even in use, with a minute of warning, unless held or kept; Keep it running starts it again', () => {
    const life = { idleMs: MIN, maxLifeMs: 60 * MIN };
    const x = use({ inUse: true, lifeFrom: 0 });
    expect(lifeEndsAt(x, life, 0)).toBe(60 * MIN);
    expect(lifeWarning(x, life, 58 * MIN)).toBe(false);
    expect(lifeWarning(x, life, 59 * MIN)).toBe(true);
    expect(stopWhy(x, life, 60 * MIN)).toBe('lifetime');
    expect(stopWhy({ ...x, lifeFrom: 59 * MIN }, life, 60 * MIN)).toBeNull();
    expect(stopWhy({ ...x, held: true }, life, 99 * MIN)).toBeNull();
    expect(stopWhy({ ...x, pinnedUntil: Infinity }, life, 99 * MIN)).toBeNull();
    expect(lifeEndsAt(x, rules, 0)).toBeNull(); // 0 = no max lifetime
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
    const pulls = Array.from({ length: OPEN_PULLS_LISTED }, (_, i) => ({ number: 100 + i, state: 'OPEN' }));
    expect(closedPrs([run(4)], 'o/r', pulls)).toEqual([]);
  });
});

describe('previews in use, the main preview and leftovers (#204)', () => {
  it('never evicts a preview an agent is testing in or the manager keeps', () => {
    const runs = [run(1, { viewedAt: 100, held: true }), run(2, { viewedAt: 900, slot: 2 })];
    expect(pickEviction(runs, new Set())).toBe('o/r#2');
    expect(pickEviction(runs, new Set(['o/r#2']))).toBeNull();
    expect(pickEviction([run(1, { viewedAt: 100, pinned: true }), run(2, { viewedAt: 900, slot: 2 })], new Set())).toBe('o/r#2');
  });

  it('picks the PR slot desks no preview runs from, never the main one or a stray folder', () => {
    expect(leftoverPrDesks(['preview', 'preview-pr-1', 'preview-pr-2', 'ada', 'preview-pr-x'], ['preview-pr-1'])).toEqual(['preview-pr-2']);
  });

  it('keeps the settings in range', () => {
    expect([clampRecentHours(0), clampRecentHours('x'), clampRecentHours(72)]).toEqual([1, 48, 72]);
    expect([clampMainIdleMin(-5), clampMainIdleMin(undefined), clampMainIdleMin(0), clampMainIdleMin(45), clampMainIdleMin(0.4)]).toEqual([0, 1, 0, 45, 1]);
    expect([clampMaxLifeHours(-1), clampMaxLifeHours('x'), clampMaxLifeHours(4), clampMaxLifeHours(9999)]).toEqual([0, 0, 4, 168]);
  });

  it('defaults to a minute after the last use, the env var only a fallback for the PR stop (#252)', () => {
    expect(previewSettings({}, {})).toMatchObject({ mainPreviewIdleMin: 1, prPreviewIdleMin: 1, previewMaxLifeHours: 0 });
    expect(previewSettings({}, {}, 20).prPreviewIdleMin).toBe(20);
    expect(previewSettings({ prPreviewIdleMin: 5 }, {}, 20).prPreviewIdleMin).toBe(5);
    expect(previewSettings({ prPreviewIdleMin: 5 }, { prPreviewIdleMin: 0, previewMaxLifeHours: 3 })).toMatchObject({ prPreviewIdleMin: 0, previewMaxLifeHours: 3 });
  });

  it('adds up the memory freed by stopped previews', () => {
    expect(addFreed(null, 640.4)).toEqual({ mb: 640, count: 1 });
    expect(addFreed({ mb: 640, count: 1 }, 560)).toEqual({ mb: 1200, count: 2 });
  });

  it("moves a state file still on the old 30-minute default to 1 minute, never the manager's own choice", () => {
    expect(upgradePreviewIdle({ mainPreviewIdleMin: 30 })).toBe(1);
    expect(upgradePreviewIdle({ mainPreviewIdleMin: 45 })).toBeNull();
    expect(upgradePreviewIdle({ mainPreviewIdleMin: 30, prPreviewIdleMin: 1 })).toBeNull();
    expect(upgradePreviewIdle(undefined)).toBeNull();
  });
});
