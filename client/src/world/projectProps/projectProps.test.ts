import { describe, expect, it } from 'vitest';
import { PROP_SETS } from '../../../../shared/floorProps';
import { DECOR_SLOTS } from '../../../../shared/progress';
import { reservedDecorRects } from '../decor/decor';
import { THEME_PACKS } from '../floorThemes/packs';
import { themePropRects, themeWallRects } from '../floorThemes/placement';
import { APP_SCREEN, DECOR_SLOT_AT, HALF_D, HALF_W, officeColliders, type Rect } from '../layout';
import { roombaRects } from '../toys/roombaBrain';
import { findPath, spot, walkways, WALK_R } from '../walkways';
import { ago, clipsApproved, floorBoard, gitLog, latestMerge, launchCountdown, notices, teamStatus, tenantStatus } from './screens';
import { ITEM_SIZE, PROJECT_SETS, PROJECT_SPOTS, projectItems, projectRects, reservedProjectRects, type SpotId } from './spots';

const overlaps = (a: Rect, b: Rect, pad = 0) => a.minX < b.maxX + pad && a.maxX > b.minX - pad && a.minZ < b.maxZ + pad && a.maxZ > b.minZ - pad;
const same = (a: Rect, b: Rect) => Math.abs(a.minX - b.minX) < 1e-9 && Math.abs(a.minZ - b.minZ) < 1e-9;

describe('project props: where they stand (#536)', () => {
  it.each(PROP_SETS.map((s) => [s] as const))('%s: every prop fits its spot, of the right kind and height', (set) => {
    expect(projectItems(set).length).toBeGreaterThanOrEqual(2);
    for (const [id, item] of Object.entries(PROJECT_SETS[set])) {
      const s = PROJECT_SPOTS[id as SpotId];
      const size = ITEM_SIZE[item];
      expect(!!size, `${item} in ${id}`).toBe(s.kind === 'floor');
      if (!size) continue;
      expect(size.w, `${item} in ${id}`).toBeLessThanOrEqual(s.w);
      expect(size.d, `${item} in ${id}`).toBeLessThanOrEqual(s.d);
      expect(size.h, `${item} in ${id}`).toBeLessThanOrEqual(s.maxH);
    }
  });

  it.each(PROP_SETS.map((s) => [s] as const))('%s: what stands on the floor stays in its kept spot, off desks, furniture, walkways and every theme', (set) => {
    const kept = reservedProjectRects();
    const w = walkways('office');
    for (const r of projectRects(set)) {
      expect(kept.some((k) => r.minX >= k.minX - 1e-6 && r.maxX <= k.maxX + 1e-6 && r.minZ >= k.minZ - 1e-6 && r.maxZ <= k.maxZ + 1e-6), JSON.stringify(r)).toBe(true);
      expect(r.minX >= -HALF_W && r.maxX <= HALF_W && r.minZ >= -HALF_D && r.maxZ <= HALF_D).toBe(true);
      for (const c of officeColliders()) expect(overlaps(r, c), JSON.stringify({ r, c })).toBe(false);
      for (const s of [...w.spots, ...w.homes]) expect(overlaps(r, { minX: s.x, maxX: s.x, minZ: s.z, maxZ: s.z }, WALK_R), s.id).toBe(false);
    }
  });

  it('keeps its floor spots apart from the decoration slots, the themes and everything the roomba steers round', () => {
    const kept = reservedProjectRects();
    expect(kept).toHaveLength(4);
    const others = roombaRects('office').filter((r) => !kept.some((k) => same(k, r)));
    const themed = Object.values(THEME_PACKS).flatMap((p) => [...themePropRects(p, {}), ...themeWallRects(p)]);
    for (const k of kept) {
      for (const o of [...others, ...reservedDecorRects(), ...themed]) expect(overlaps(k, o), JSON.stringify({ k, o })).toBe(false);
    }
  });

  it('leaves every desk and spot reachable from the elevator', () => {
    const w = walkways('office');
    const kept = reservedProjectRects();
    expect(roombaRects('office').filter((r) => kept.some((k) => same(k, r)))).toHaveLength(kept.length); // the walkways plan round them
    const lift = spot(w, 'elevator')!;
    for (const s of [...w.spots, ...w.homes]) expect(findPath(w, lift, s), s.id).not.toBeNull();
  });

  it("hangs its pictures and screens on free wall: off the decoration slots' pictures and the office's signs and screens", () => {
    const along = (o: { x: number; z: number; rotY: number }) => (Math.abs(Math.sin(o.rotY)) > 0.5 ? o.z : o.x);
    const hung = [
      ...DECOR_SLOTS.filter((d) => d.kind === 'wall').map((d) => ({ ...DECOR_SLOT_AT[d.id], h: 1.3, y: DECOR_SLOT_AT[d.id].y! })),
      { x: APP_SCREEN.x, z: -HALF_D, rotY: 0, w: APP_SCREEN.w + 0.2, h: APP_SCREEN.h + 0.2, y: APP_SCREEN.y },
      { x: 10, z: -HALF_D, rotY: 0, w: 2.4, h: 1.5, y: 2.2 }, // "ship it" and the themes' big screen
      { x: -10, z: -HALF_D, rotY: 0, w: 0.7, h: 0.7, y: 2.75 }, // the clock
      { x: -4.6, z: HALF_D, rotY: Math.PI, w: 4.2, h: 1.3, y: 1.95 }, // the floor's sign
      { x: 4.6, z: HALF_D, rotY: Math.PI, w: 4.2, h: 1.6, y: 2.05 }, // the team sign and its beacon
    ];
    const mine = Object.entries(PROJECT_SPOTS).filter(([, s]) => s.kind === 'wall');
    for (const [id, s] of mine) {
      const others = [...hung, ...mine.filter(([j]) => j !== id).map(([, x]) => ({ ...x, h: x.d }))].filter((o) => Math.abs(Math.cos(o.rotY - s.rotY) - 1) < 1e-6);
      for (const o of others) {
        const apart = Math.abs(along(s) - along(o)) >= (s.w + o.w) / 2 || Math.abs(s.y - o.y) >= (s.d + o.h) / 2;
        expect(apart, `${id} and ${JSON.stringify(o)}`).toBe(true);
      }
      expect(s.y + s.d / 2).toBeLessThan(3.6);
    }
  });
});

describe('project props: what the screens show (#536)', () => {
  const now = new Date(2026, 10, 12, 15, 0);
  const iso = (d: number, h: number) => new Date(2026, 10, d, h).toISOString();
  const pulls = [
    { number: 7, title: 'Restore wizard', state: 'MERGED' as const, mergedAt: iso(12, 9), checks: 'passing' as const },
    { number: 9, title: 'Tenant picker', state: 'MERGED' as const, mergedAt: iso(12, 13), checks: 'passing' as const },
    { number: 5, title: 'Old one', state: 'MERGED' as const, mergedAt: iso(10, 13), checks: 'passing' as const },
    { number: 11, title: 'Drift report', state: 'OPEN' as const, mergedAt: null, checks: 'failing' as const },
    { number: 12, title: 'Snapshot diff', state: 'OPEN' as const, mergedAt: null, checks: 'pending' as const },
    { number: 13, title: 'From outside', state: 'OPEN' as const, mergedAt: null, checks: 'none' as const, untrusted: true },
  ];

  it("shows the Kanban's columns and today's merges on the board screen", () => {
    const card = { key: 'k', number: 1, title: 't' };
    expect(floorBoard({ progress: [card, card], qa: [card], ready: [] }, pulls, now)).toEqual({ progress: 2, qa: 1, ready: 0, mergedToday: 2 });
    expect(floorBoard({ progress: [], qa: [], ready: [] }, [], now)).toEqual({ progress: 0, qa: 0, ready: 0, mergedToday: 0 });
  });

  it('heads it with the latest merge, and dashes without one', () => {
    expect(latestMerge(pulls)).toMatchObject({ number: 9, title: 'Tenant picker' });
    expect(latestMerge([])).toBeNull();
    expect(ago(null, now.getTime())).toBe('—');
    expect(ago(now.getTime() - 5 * 60_000, now.getTime())).toBe('5 min ago');
    expect(ago(now.getTime() - 3 * 3_600_000, now.getTime())).toBe('3 h ago');
    expect(ago(now.getTime() - 3 * 86_400_000, now.getTime())).toBe('3 d ago');
  });

  it("counts the team without the CEO: working, free and needing help", () => {
    const team = teamStatus([
      { role: 'agent', status: 'working' },
      { role: 'agent', status: 'preparing' },
      { role: 'agent', status: 'idle' },
      { role: 'agent', status: 'done' },
      { role: 'agent', status: 'error' },
      { role: 'ceo', status: 'working' },
    ]);
    expect(team).toEqual({ working: 2, free: 2, help: 1 });
  });

  it("gives the tenant screen the last merge and its open PRs' gates, newest first, outsiders left off", () => {
    const t = tenantStatus('o/keel', pulls, { 'o/keel#11': { status: 'fixing' } });
    expect(t.lastMerge).toBe(Date.parse(iso(12, 13)));
    expect(t.open).toBe(2);
    expect(t.gates).toEqual([
      { number: 12, title: 'Snapshot diff', checks: 'pending', qa: null },
      { number: 11, title: 'Drift report', checks: 'failing', qa: 'fixing' },
    ]);
    expect(tenantStatus('o/keel', [], {})).toEqual({ lastMerge: null, gates: [], open: 0 });
  });

  it("counts down to the first launch date in the mission or charter that hasn't passed", () => {
    expect(launchCountdown(['Ship v1 by 2026-10-01, launch on 2026-11-19'], now)).toEqual({ date: '2026-11-19', days: 7 });
    expect(launchCountdown(['', 'Launch 2026-11-12'], now)).toEqual({ date: '2026-11-12', days: 0 });
    expect(launchCountdown(['No dates here', 'only 2025-01-01'], now)).toBeNull();
  });

  it('counts approved clips, lists notices and the git log from real data', () => {
    expect(clipsApproved(pulls, now)).toEqual({ today: 2, total: 3 });
    expect(notices([{ number: 3, title: 'a' }, { number: 8, title: 'b' }, { number: 9, title: 'x', untrusted: true }])).toEqual([{ number: 8, title: 'b' }, { number: 3, title: 'a' }]);
    expect(gitLog(pulls, 2)).toEqual(['#9 Tenant picker', '#7 Restore wizard']);
  });
});
