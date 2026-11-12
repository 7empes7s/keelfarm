import { HALF_D } from '../client/src/world/layout';
import type { Page } from '@playwright/test';
import { enterOffice, expect, savedView, startAt, test } from './helpers';
import { decodePng } from './png';

// Floor themes (#370, #371): each theme dresses a floor live, with no reload and no console errors, and the lobby's
// directory takes you to the floor you aim at. Screenshots of every theme's north wall land in the test's output.
// A floor's use case picks its theme until the manager picks one by hand (#528).

const NEW_THEMES = ['design-studio', 'media-studio', 'research-lab', 'ops-control', 'newsroom'] as const;

test("the lobby directory lists the floors and takes you to the one you aim at", async ({ page }) => {
  // In front of the directory on the lobby's south wall, looking up at its top row (the top floor).
  await startAt(page, { floor: 0, x: 4.4, z: HALF_D - 2.4, yaw: Math.PI, pitch: 0.28 });
  await enterOffice(page);
  await expect(page.getByText(/Go to floor 3 · demo-co\/recipe-box/)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('lobby-directory.png') });
  await page.keyboard.press('e');
  await expect.poll(async () => (await savedView(page))?.floor, { timeout: 30_000 }).toBe(3);
});

test('every new floor theme dresses the floor live, its wall screen and props included', async ({ page, request }) => {
  const state = (await (await request.get('/api/state')).json()) as { repos: { id: string; floor: number }[] };
  const floor1 = state.repos.find((r) => r.floor === 1)!;
  // On floor 1, back from the north wall's big screen (x 10), looking at it.
  await startAt(page, { floor: 1, x: 10, z: -HALF_D + 6, yaw: 0, pitch: 0.12 });
  await enterOffice(page);
  for (const theme of NEW_THEMES) {
    expect((await request.patch(`/api/repos/${encodeURIComponent(floor1.id)}`, { data: { theme } })).ok()).toBe(true);
    await page.waitForTimeout(4000); // the lazy chunk, then a few software-WebGL frames
    await page.screenshot({ path: test.info().outputPath(`theme-${theme}.png`) });
  }
  await request.patch(`/api/repos/${encodeURIComponent(floor1.id)}`, { data: { theme: 'office' } });
});

/** The canvas's pixels, everything else hidden. */
async function picture(page: Page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('the canvas has no size');
  return decodePng(await page.screenshot({ clip: box, caret: 'initial', style: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' }));
}

/** The mean brightness (0-255) of a picture. */
function brightness({ width, height, data }: { width: number; height: number; data: Uint8Array }) {
  let sum = 0;
  for (let p = 0; p < width * height; p++) sum += (data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2]) / 3;
  return sum / (width * height);
}

/** How different two pictures of the same size are: the mean change per channel (0-255). */
function difference(a: { data: Uint8Array }, b: { data: Uint8Array }) {
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) if (i % 4 !== 3) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / ((a.data.length / 4) * 3);
}

test("a floor's use case picks its look until the manager picks one by hand", async ({ page, request }) => {
  type Floor = { id: string; floor: number; theme: string; themeByHand?: true };
  const floor3 = async () => ((await (await request.get('/api/state')).json()) as { repos: Floor[] }).repos.find((r) => r.floor === 3)!;
  const { id, theme, themeByHand } = await floor3();
  expect({ theme, themeByHand }).toEqual({ theme: 'trading', themeByHand: undefined }); // dressed by the demo, not by hand
  const repo = `/api/repos/${encodeURIComponent(id)}`;
  const setUseCase = async (useCase: string) => expect((await request.put(`${repo}/setup/use-case`, { data: { useCase } })).ok()).toBe(true);
  const settle = () => page.waitForTimeout(4000); // the lazy chunk, then a few software-WebGL frames
  await startAt(page, { floor: 3, x: 10, z: -HALF_D + 6, yaw: 0, pitch: 0.12 });
  await enterOffice(page);
  await settle();
  const trading = await picture(page);

  await setUseCase('video');
  expect((await floor3()).theme).toBe('media-studio');
  await settle();
  await page.screenshot({ path: test.info().outputPath('use-case-video.png') });
  const media = await picture(page);
  expect(difference(media, trading)).toBeGreaterThan(8); // re-dressed
  expect(brightness(media)).toBeGreaterThan(brightness(trading) - 25); // and never a dark room (#570)

  // Office by hand: the use case changing again leaves it alone.
  expect((await request.patch(repo, { data: { theme: 'office' } })).ok()).toBe(true);
  await setUseCase('design');
  await setUseCase('video');
  expect(await floor3()).toMatchObject({ theme: 'office', themeByHand: true });
  await settle();
  await page.screenshot({ path: test.info().outputPath('picked-office.png') });
  expect(difference(await picture(page), media)).toBeGreaterThan(8);
});
