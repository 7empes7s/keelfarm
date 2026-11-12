import { describe, expect, it } from 'vitest';
import { DECOR_SLOTS } from '../../../../shared/progress';
import { EMPTY_NUMBERS } from '../../ops';
import { reservedDecorRects } from '../decor/decor';
import { gradeAt, floorGrade, withFloorGrade } from '../gfx/grading';
import { SONGS } from '../jukeboxSongs';
import { DECOR_SLOT_AT, HALF_D, HALF_W, officeColliders, type Rect } from '../layout';
import { findPath, spot, walkways, WALK_R } from '../walkways';
import { THEME_PACKS, themePack } from './packs';
import { nocBankRect, nocPanels, NOC_BANK, placeProp, PROP_SPECS, themePropRects, themeProps, themeWallRects } from './placement';
import { buildProgress, candles, marketOpen, tickerQuotes, worldClocks } from './ticker';

const PACKS = Object.values(THEME_PACKS);
const overlaps = (a: Rect, b: Rect, pad = 0) => a.minX < b.maxX + pad && a.maxX > b.minX - pad && a.minZ < b.maxZ + pad && a.maxZ > b.minZ - pad;
const contains = (outer: Rect, inner: Rect) => inner.minX >= outer.minX - 1e-6 && inner.maxX <= outer.maxX + 1e-6 && inner.minZ >= outer.minZ - 1e-6 && inner.maxZ <= outer.maxZ + 1e-6;

describe('theme resolution', () => {
  it('has no pack for the plain office or an unknown theme, so those floors draw as before', () => {
    expect(themePack('office')).toBeNull();
    expect(themePack(undefined)).toBeNull();
    expect(themePack('casino' as never)).toBeNull();
    expect(themePack('game-studio')!.wallScreen).toBe('playtest');
    expect(themePack('trading')!.merge).toBe('bell');
  });

  it("leaves High's grade untouched without a theme, and tints it with one", () => {
    const plain = gradeAt(0.5);
    expect(withFloorGrade(gradeAt(0.5), null)).toEqual(plain);
    const studio = withFloorGrade(gradeAt(0.5), floorGrade(THEME_PACKS['game-studio'].mood.grade));
    expect(studio.shadows.b).toBeGreaterThan(studio.shadows.g);
    expect(studio.saturation).toBeGreaterThan(1);
  });

  it("names only songs the jukebox has", () => {
    for (const p of PACKS) for (const id of p.playlist) expect(SONGS.some((s) => s.id === id), id).toBe(true);
  });
});

describe('theme props', () => {
  it.each(PACKS.map((p) => [p.id, p] as const))('%s: every prop fits its slot, of the right kind', (_, pack) => {
    for (const [slot, prop] of Object.entries(pack.props)) {
      const d = DECOR_SLOTS.find((x) => x.id === slot);
      expect(d, slot).toBeDefined();
      const spec = PROP_SPECS[prop];
      expect(spec.kind, `${prop} in ${slot}`).toBe(d!.kind);
      const s = DECOR_SLOT_AT[slot];
      expect(spec.w, `${prop} in ${slot}`).toBeLessThanOrEqual(s.w);
      if (spec.kind !== 'wall') expect(spec.d, `${prop} in ${slot}`).toBeLessThanOrEqual(s.d);
      expect(placeProp(slot, prop), `${prop} in ${slot}`).not.toBeNull();
    }
  });

  it.each(PACKS.map((p) => [p.id, p] as const))('%s: what stands on the floor stays inside the room its slot keeps, off walkways, desks and furniture', (_, pack) => {
    const reserved = reservedDecorRects();
    const rects = themePropRects(pack, {});
    expect(rects.length).toBeGreaterThan(0);
    const w = walkways('office');
    for (const r of rects) {
      expect(reserved.some((k) => contains(k, r)), JSON.stringify(r)).toBe(true);
      for (const c of officeColliders()) expect(overlaps(r, c), JSON.stringify({ r, c })).toBe(false);
      for (const s of [...w.spots, ...w.homes]) expect(overlaps(r, { minX: s.x, maxX: s.x, minZ: s.z, maxZ: s.z }, WALK_R), s.id).toBe(false);
      expect(r.minX >= -HALF_W && r.maxX <= HALF_W && r.minZ >= -HALF_D && r.maxZ <= HALF_D).toBe(true);
    }
    // every spot is still reachable from the elevator (the walkways already plan round the slots' rooms)
    const lift = spot(w, 'elevator')!;
    for (const s of [...w.spots, ...w.homes]) expect(findPath(w, lift, s), s.id).not.toBeNull();
  });

  it('steps aside for an earned decoration, which keeps its slot', () => {
    const pack = THEME_PACKS['game-studio'];
    const all = themeProps(pack, {});
    const earned = themeProps(pack, { 'b-west': 'fishtank', 'w-west': 'neon' });
    expect(all.map((p) => p.slot)).toContain('b-west');
    expect(earned.map((p) => p.slot)).not.toContain('b-west');
    expect(earned.map((p) => p.slot)).not.toContain('w-west');
    expect(earned).toHaveLength(all.length - 2);
    expect(themePropRects(pack, { 'b-west': 'fishtank' })).toHaveLength(themePropRects(pack, {}).length - 1);
    expect(themeProps(null, {})).toEqual([]);
  });

  it('turns the TV round to face the couch', () => {
    const tv = placeProp('b-lounge', 'tv-console')!;
    expect(Math.sin(tv.rotY)).toBeCloseTo(-1); // facing west, at the couch against the west wall
    expect(placeProp('b-lounge', 'arcade')).toBeNull(); // a floor prop in a big slot
  });
});

describe("the ops room's status wall (#371)", () => {
  it('curves its panels round the north wall, facing in, and only on the ops floor', () => {
    const p = nocPanels();
    expect(p).toHaveLength(NOC_BANK.cols * NOC_BANK.rows);
    const top = p.slice(0, NOC_BANK.cols);
    expect(top[0].rotY).toBeGreaterThan(0); // the left end turns to face right
    expect(top[NOC_BANK.cols - 1].rotY).toBeLessThan(0);
    for (const q of p) expect(q.z).toBeGreaterThanOrEqual(-HALF_D);
    expect(themeWallRects(THEME_PACKS['ops-control'])).toEqual([nocBankRect()]);
    for (const pack of PACKS.filter((x) => x.id !== 'ops-control')) expect(themeWallRects(pack)).toEqual([]);
  });

  it('stays out of the walkways, off the slots and the office furniture, and leaves every spot reachable', () => {
    const r = nocBankRect();
    expect(r.maxZ - r.minZ).toBeLessThan(0.6);
    const w = walkways('office');
    for (const s of [...w.spots, ...w.homes]) {
      expect(overlaps(r, { minX: s.x, maxX: s.x, minZ: s.z, maxZ: s.z }, WALK_R), s.id).toBe(false);
      const path = findPath(w, spot(w, 'elevator')!, s);
      for (const pt of path ?? []) expect(overlaps(r, { minX: pt.x, maxX: pt.x, minZ: pt.z, maxZ: pt.z }, WALK_R), `${s.id} path`).toBe(false);
    }
    for (const k of reservedDecorRects()) expect(overlaps(r, k), JSON.stringify(k)).toBe(false);
    for (const c of officeColliders()) expect(overlaps(r, c), JSON.stringify(c)).toBe(false);
  });
});

describe('the trading floor ticker', () => {
  const n = { ...EMPTY_NUMBERS, mergedToday: 4, mergedHour: 1, qaPass: 0.75, costToday: 10, ciPass: 0.9 };

  it("shows the floor's own numbers", () => {
    const { quotes } = tickerQuotes(n, 3);
    const by = Object.fromEntries(quotes.map((q) => [q.symbol, q]));
    expect(by.MRG.text).toBe('4 today');
    expect(by.MRG.dir).toBe('up'); // a merge in the last hour
    expect(by.QA.text).toBe('75%');
    expect(by.CPM.text).toBe('$2.50');
    expect(by.OPEN.text).toBe('3 PRs');
    expect(tickerQuotes(EMPTY_NUMBERS, 0).quotes.find((q) => q.symbol === 'CPM')!.text).toBe('—');
  });

  it('moves each arrow against the value it showed before, green when the move is good', () => {
    const first = tickerQuotes(n, 3);
    const next = tickerQuotes({ ...n, mergedToday: 5, costToday: 10 }, 5, first.values);
    const by = Object.fromEntries(next.quotes.map((q) => [q.symbol, q]));
    expect(by.MRG).toMatchObject({ dir: 'up', good: true });
    expect(by.CPM).toMatchObject({ dir: 'down', good: true }); // $2.00 a merge now
    expect(by.OPEN).toMatchObject({ dir: 'up', good: false });
    expect(by.QA).toMatchObject({ dir: 'flat', good: true });
  });

  it('draws merges per hour as candles: up in an hour with merges, slipping without', () => {
    const c = candles([0, 2, 0]);
    expect(c[0].close).toBeLessThan(c[0].open);
    expect(c[1].close).toBe(c[1].open + 6);
    expect(c[1].open).toBe(c[0].close);
    for (const k of c) expect(k.high).toBeGreaterThan(Math.max(k.open, k.close));
  });

  it('opens the market on weekdays in office hours', () => {
    expect(marketOpen(10, 2)).toBe(true);
    expect(marketOpen(9.4, 2)).toBe(false);
    expect(marketOpen(16, 2)).toBe(false);
    expect(marketOpen(12, 6)).toBe(false);
    expect(marketOpen(12, 0)).toBe(false);
  });

  it('tells the time in New York, London and Tokyo', () => {
    const at = new Date('2026-01-15T15:30:00Z');
    const by = Object.fromEntries(worldClocks(at).map((c) => [c.city, c]));
    expect(by['NEW YORK']).toMatchObject({ h: 10, m: 30 });
    expect(by.LONDON).toMatchObject({ h: 15, m: 30 });
    expect(by.TOKYO).toMatchObject({ h: 0, m: 30 });
    expect(by.HERE).toMatchObject({ h: at.getHours(), m: at.getMinutes() });
  });
});

describe("the game studio's build bar", () => {
  it('fills as the open PRs get closer to merging', () => {
    expect(buildProgress([]).done).toBe(1);
    const early = buildProgress(['inQa', 'fixing']);
    const late = buildProgress(['toMerge', 'toMerge']);
    expect(late.done).toBeGreaterThan(early.done);
    expect(late.caption).toBe('2 PRs in the build · 2 ready to ship');
  });
});
