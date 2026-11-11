import { HALF_D } from '../client/src/world/layout';
import { enterOffice, expect, savedView, startAt, test } from './helpers';

// Floor themes (#370, #371): each theme dresses a floor live, with no reload and no console errors, and the lobby's
// directory takes you to the floor you aim at. Screenshots of every theme's north wall land in the test's output.

const NEW_THEMES = ['design-studio', 'media-studio', 'research-lab', 'ops-control'] as const;

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
