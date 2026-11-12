import { devices, test as base, type Page } from '@playwright/test';
import { gb } from '../shared/health';
import { IT_VISITOR } from '../client/src/world/layout';
import { MODELS } from '../client/src/world/models/registry';
import { enterOffice, expect, startAt, test } from './helpers';

// The lobby's IT office (#535): its CC0 models load (and a missing one falls back to shapes with no error), the wall
// screen shows the office's own readings, the draw calls stay in budget, and E (or a tap) on the IT lead opens IT's
// chat, closed again by its ×, on a desktop and at 390 px.

type ItWindow = { __swarmModels: Record<string, string>; __swarmItOffice: { rows: { label: string; value: string }[] }; __swarmStats: { fps: number; calls: number } };
const AT_DESK = { floor: 0, x: IT_VISITOR.x, z: IT_VISITOR.z, yaw: -Math.PI / 2, pitch: -0.12 }; // across the counter, looking east at the lead
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent };

const models = (page: Page) => page.evaluate(() => (window as unknown as ItWindow).__swarmModels ?? {});

async function expectChatOpensAndCloses(page: Page, open: () => Promise<void>) {
  await expect(page.getByText(/Chat with .+, IT/).first()).toBeVisible({ timeout: 30_000 });
  await open();
  const chat = page.getByRole('region', { name: /IT chat with/ });
  await expect(chat).toBeVisible();
  await page.getByRole('button', { name: /^Close/ }).first().click();
  await expect(chat).toBeHidden();
}

test('the IT office: models, the wall screen from the API, smooth enough, and E opens IT’s chat', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startAt(page, AT_DESK);
  await page.goto('/?stats');
  await enterOffice(page, { loaded: true });
  await expect.poll(() => models(page), { timeout: 30_000 }).toEqual(Object.fromEntries(Object.keys(MODELS).map((m) => [m, 'ok'])));

  // the screen's numbers are the office's own readings
  const state = (await (await request.get('/api/state')).json()) as { health: { memory: { availableMb: number; totalMb: number }; disk: { disks: { freeMb: number }[] } } };
  const rows = await page.evaluate(() => (window as unknown as ItWindow).__swarmItOffice.rows);
  expect(rows[0]).toEqual(expect.objectContaining({ label: 'Disk free', value: gb(Math.min(...state.health.disk.disks.map((d) => d.freeMb))) }));
  expect(rows[1].value).toBe(`${(state.health.memory.availableMb / 1024).toFixed(1)} of ${gb(state.health.memory.totalMb)}`);

  await page.waitForTimeout(3000);
  const stats = await page.evaluate(() => (window as unknown as ItWindow).__swarmStats);
  expect(stats.fps).toBeGreaterThan(0);
  expect(stats.calls, 'draw calls looking into the IT office').toBeLessThan(700);
  await page.screenshot({ path: test.info().outputPath('it-office.png') });

  await expectChatOpensAndCloses(page, () => page.keyboard.press('e'));
});

test.describe('on a phone', () => {
  test.use(PHONE);
  test('a tap on the IT lead opens IT’s chat at 390 px', async ({ page }) => {
    await startAt(page, AT_DESK);
    await enterOffice(page);
    await expectChatOpensAndCloses(page, () => page.locator('canvas').first().tap({ position: { x: 195, y: 380 } }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

// Its own fixture: the fixture in helpers.ts counts the 404 this test asks for as a failure.
base('a model that 404s falls back to its shapes, with no error', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && problems.push(m.text()));
  await page.route('**/models/kenney/pottedPlant.glb', (r) => r.fulfill({ status: 404, body: '' }));
  await startAt(page, AT_DESK);
  await enterOffice(page);
  await expect.poll(async () => (await models(page)).plant, { timeout: 30_000 }).toBe('failed');
  await expect.poll(async () => (await models(page)).cabinet, { timeout: 30_000 }).toBe('ok');
  await expect(page.getByText(/Chat with .+, IT/).first()).toBeVisible({ timeout: 30_000 });
  expect(problems).toEqual([]);
});
