import { describe, expect, it } from 'vitest';
import { linkedSection, overlayRoute, parseRoute, routeHash, routeKind, routeTarget, ROUTES, sampleLinks, type Mode, type World } from './routes';
import { standPose, yawFor } from './world/routeStand';

const world: World = {
  floor: 1,
  repos: [
    { id: 'r1', floor: 1, pulls: [{ number: 12, state: 'OPEN', headSha: 'abc' } as World['repos'][number]['pulls'][number]] },
    { id: 'r2', floor: 2, pulls: [] },
  ],
  agents: {
    ceo: { id: 'ceo', name: 'Mimoun', repoId: '', desk: 0, role: 'ceo' },
    a1: { id: 'a1', name: 'Linus', repoId: 'r1', desk: 3, role: 'agent' },
  },
};

const MODES: Mode[] = ['pocket', 'office'];
const kind = (h: string) => routeKind(parseRoute(h)!);

describe('the route table (#413)', () => {
  it('every sample link parses, opens something and formats back to the same link, in both offices', () => {
    for (const mode of MODES) {
      const links = sampleLinks(world, mode);
      expect(links.length).toBeGreaterThan(19);
      for (const h of links) {
        const r = parseRoute(h);
        expect(r, h).not.toBeNull();
        expect(routeHash(r!), h).toBe(h);
        expect(routeTarget(r!, world, mode), `${mode} ${h}`).not.toBeNull();
      }
    }
  });

  it('every row of the table has a sample link in each office it lists, and opens in no other', () => {
    for (const mode of MODES) {
      const covered = new Set(sampleLinks(world, mode).map(kind));
      for (const row of ROUTES) for (const k of row.kinds) expect(covered.has(k), `${k} in ${mode}`).toBe(row.modes.includes(mode));
    }
    const rows = ROUTES.flatMap((r) => r.kinds);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it('what an overlay opened by a link writes to the address is that link (a shortcut like #tab/chat or #sound: a link to the same view)', () => {
    for (const mode of MODES)
      for (const h of sampleLinks(world, mode)) {
        const r = parseRoute(h)!;
        const t = routeTarget(r, world, mode)!;
        const back = overlayRoute(t.overlay, world, mode);
        if (!back) continue;
        if (r.to === 'tab' || r.to === 'sound') expect(routeTarget(back, world, mode)?.overlay, `${mode} ${h}`).toEqual(t.overlay);
        else expect(routeHash(back), `${mode} ${h}`).toBe(h);
      }
    expect(overlayRoute({ kind: 'terminal', agentId: 'a1', view: 'terminal' }, world, 'pocket')).toEqual({ to: 'agent', name: 'Linus', tab: 'terminal' });
    expect(overlayRoute({ kind: 'kanban', repoId: 'r1' }, world, 'pocket')).toBeNull(); // the Kanban tab's, not a link of its own
    expect(overlayRoute({ kind: 'manager', tab: 'ops' }, world, 'office')).toBeNull(); // ConsoleNav writes #company/ops
  });

  it('opens what QA asks for', () => {
    const office = (h: string) => routeTarget(parseRoute(h)!, world, 'office');
    const pocket = (h: string) => routeTarget(parseRoute(h)!, world, 'pocket');
    expect(pocket('#tab/team')).toMatchObject({ tab: 'team', ready: '.pk-main[data-tab="team"]' });
    expect(pocket('#tab/chat')?.ready).toBe('.pocket .phone-chat');
    expect(office('#tab/chat')?.overlay).toEqual({ kind: 'phone', tab: 'chat' });
    expect(office('#agent/linus/setup')).toMatchObject({ overlay: { kind: 'terminal', agentId: 'a1', details: 'setup' }, stand: { floor: 1, at: { desk: 3 } } });
    expect(office('#pr/1/12')?.overlay).toEqual({ kind: 'card', repoId: 'r1', key: 'pr-12', number: 12, pr: true });
    expect(office('#issue/2/7')?.overlay).toEqual({ kind: 'card', repoId: 'r2', key: 'i-7', number: 7, pr: false });
    expect(office('#floor/2/kanban')).toMatchObject({ overlay: { kind: 'kanban', repoId: 'r2' }, stand: { floor: 2, at: 'board' } });
    expect(office('#3d/maproom')).toMatchObject({ overlay: { kind: 'mapRoom' }, stand: { floor: 0, at: 'ceo' } });
    expect(office('#3d/desk/mimoun')?.stand).toEqual({ floor: 0, at: 'ceo' });
    expect(office('#3d/it')).toMatchObject({ overlay: null, stand: { floor: 0, at: 'it' } }); // the IT office (#535)
    expect(office('#settings/providers')?.overlay).toEqual({ kind: 'manager', tab: 'providers' });
    expect(pocket('#settings/providers')).toMatchObject({ native: true, ready: '.pk-settings' });
  });

  it('takes the console in every spelling and refuses what names nothing here', () => {
    expect(parseRoute('#console/settings/providers')).toEqual({ to: 'console', section: 'providers' });
    expect(parseRoute('#console/providers')).toEqual({ to: 'console', section: 'providers' });
    expect(parseRoute('#settings/pocket')).toEqual({ to: 'console', section: 'pocket' }); // a pocket-only section
    expect(routeTarget({ to: 'console', section: 'pocket' }, world, 'office')).toBeNull();
    expect(parseRoute('#agent/Ada%20Lovelace')).toEqual({ to: 'agent', name: 'Ada Lovelace', tab: 'terminal' });
    for (const h of ['', '#', '#nope', '#floor/x/kanban', '#tab/games', '#tour/no-such-step', '#3d/roof', '#pr/1']) expect(parseRoute(h), h).toBeNull();
    expect(routeTarget(parseRoute('#agent/nobody/chat')!, world, 'office')).toBeNull();
    expect(routeTarget(parseRoute('#floor/9/kanban')!, world, 'pocket')).toBeNull();
    expect(routeTarget(parseRoute('#3d/lobby')!, world, 'pocket')).toBeNull();
  });

  it("pocket mode starts on every spelling of a console link it leaves to itself (native)", () => {
    for (const h of ['#settings/providers', '#console/settings/providers', '#console/providers']) {
      expect(routeTarget(parseRoute(h)!, world, 'pocket')?.native, h).toBe(true);
      expect(linkedSection(h, 'pocket'), h).toBe('providers');
    }
    expect(linkedSection('#settings/timelapse', 'pocket')).toBeNull(); // the 3D office's only
    expect(linkedSection('#tab/chat', 'pocket')).toBeNull();
  });
});

describe('where a 3D place stands the camera', () => {
  it('looks the way the spot faces', () => {
    expect(yawFor(-Math.PI / 2)).toBeCloseTo(0); // north: along -z, the camera's yaw 0
    expect(Math.abs(yawFor(Math.PI / 2))).toBeCloseTo(Math.PI); // south
    expect(yawFor(0)).toBeCloseTo(-Math.PI / 2); // east: along +x
    const board = standPose('board');
    expect(board.yaw).toBeCloseTo(0);
    expect(board.z).toBeLessThan(0);
    for (const s of ['elevator', 'manager', 'ceo', 'reception', 'screens', { desk: 0 }, { desk: 13 }] as const) expect(Number.isFinite(standPose(s).x + standPose(s).z + standPose(s).yaw), JSON.stringify(s)).toBe(true);
  });
});
