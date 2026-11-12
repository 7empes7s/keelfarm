import type { Page } from '@playwright/test';
import { HALF_W } from '../client/src/world/layout';
import { enterOffice, expect, startAt, test } from './helpers';

// Project props (#536): each floor shows its project's things and a live board screen whose numbers match the API, in
// the 3D office on a desktop and at 390 px, with few extra draws, every desk still reachable (projectProps.test.ts
// checks the walkways), and a model that won't load falling back to its plain shape without a console error (models/Model.tsx).
// The demo gives floor N the Nth set: vault, civic, workshop; floor 1 is switched to the video studio as the 4th.

type Found = { name: string; userData: Record<string, unknown>; meshes: number };
type State = {
  repos: { id: string; floor: number; props: string | null; pulls: { number: number; state: string; mergedAt: string | null }[] }[];
  agents: { repoId: string | null; role: string; task: string | null; status: string; issueNumber: number | null; prNumber: number | null }[];
  qa: { repoId: string; prNumber: number; status: string }[];
};

const find = (page: Page, prefix: string) => page.evaluate((p) => (window as unknown as { __swarmStats: { find(p: string): Found[] } }).__swarmStats.find(p), prefix);

/** The board's numbers as the API has them, worked out as the Kanban does (store.ts kanbanFor). */
function expected(s: State, floor: number) {
  const r = s.repos.find((x) => x.floor === floor)!;
  const open = r.pulls.filter((p) => p.state === 'OPEN');
  const ready = open.filter((p) => s.qa.some((q) => q.repoId === r.id && q.prNumber === p.number && q.status === 'passed')).length;
  const today = new Date().toDateString();
  const progress = s.agents.filter((a) => a.repoId === r.id && a.role !== 'ceo' && a.task === 'issue' && a.issueNumber != null && a.status !== 'idle' && a.prNumber == null).length;
  return { progress, qa: open.length - ready, ready, mergedToday: r.pulls.filter((p) => p.state === 'MERGED' && p.mergedAt && new Date(p.mergedAt).toDateString() === today).length };
}

const SETS: Record<number, { set: string; items: string[] }> = {
  1: { set: 'vault', items: ['project-vault-door', 'project-backup-shelf', 'project-tenant-screen'] },
  2: { set: 'civic', items: ['project-ballot-box', 'project-voting-booth', 'project-noticeboard', 'project-map-poster'] },
  3: { set: 'workshop', items: ['project-blueprint-table', 'project-robot-bench', 'project-blueprint-poster'] },
};

async function visit(page: Page, floor: number) {
  // Mid-floor, looking at the east wall's board screen.
  await startAt(page, { floor, x: HALF_W - 6, z: 1.4, yaw: -Math.PI / 2, pitch: 0.15 });
  await page.goto('/?stats&pocket=0');
  await enterOffice(page, { loaded: true });
}

async function checkFloor(page: Page, request: Parameters<Parameters<typeof test>[2]>[0]['request'], floor: number, set: string, items: string[]) {
  await expect.poll(async () => (await find(page, 'project-props-')).map((g) => g.name), { timeout: 30_000 }).toEqual([`project-props-${set}`]);
  const names = (await find(page, 'project-')).map((g) => g.name);
  for (const item of items) expect(names, item).toContain(item);
  const group = (await find(page, 'project-props-'))[0];
  expect(group.meshes, 'draws for the whole set').toBeLessThan(60);
  // The board's numbers match the API's (the demo moves on, so read both until they agree).
  await expect
    .poll(async () => {
      const s = (await (await request.get('/api/state')).json()) as State;
      const board = (await find(page, 'project-board'))[0]?.userData.board;
      return JSON.stringify(board) === JSON.stringify(expected(s, floor));
    }, { timeout: 30_000 })
    .toBe(true);
}

for (const width of [1280, 390]) {
  test(`floors 1-4 show their project props and a live board screen at ${width} px`, async ({ page, request }) => {
    test.slow(); // four cold loads of the 3D office in software WebGL
    await page.setViewportSize({ width, height: width > 600 ? 800 : 844 });
    for (const floor of [1, 2, 3]) {
      await visit(page, floor);
      await checkFloor(page, request, floor, SETS[floor].set, SETS[floor].items);
      await page.screenshot({ path: test.info().outputPath(`floor-${floor}-${width}.png`) });
    }
    // The 4th set: the video studio, picked by hand on floor 1, re-dresses it live.
    const state = (await (await request.get('/api/state')).json()) as State;
    const floor1 = state.repos.find((r) => r.floor === 1)!;
    expect(floor1.props).toBe('vault');
    await visit(page, 1);
    expect((await request.patch(`/api/repos/${encodeURIComponent(floor1.id)}`, { data: { props: 'broadcast' } })).ok()).toBe(true);
    await checkFloor(page, request, 1, 'broadcast', ['project-camera-rig', 'project-phone-bay', 'project-live-wall', 'project-countdown', 'project-clips-counter']);
    await page.screenshot({ path: test.info().outputPath(`floor-1-broadcast-${width}.png`) });
    const fps = await page.evaluate(() => (window as unknown as { __swarmStats: { fps: number } }).__swarmStats.fps);
    expect(fps).toBeGreaterThan(0);
    await request.patch(`/api/repos/${encodeURIComponent(floor1.id)}`, { data: { props: 'vault' } });
    if (width < 600) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("a model that won't load leaves its plain stand-in, with no console error", async ({ page, request }) => {
  await page.route('**/models/kenney/*.glb', (route) => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: 'not a model' }));
  await visit(page, 1);
  await checkFloor(page, request, 1, 'vault', ['project-backup-shelf']);
  expect((await find(page, 'project-backup-shelf'))[0].meshes).toBeGreaterThanOrEqual(2); // the stand-in shelf and its tapes
});
