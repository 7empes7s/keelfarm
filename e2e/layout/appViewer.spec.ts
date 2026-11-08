import { expect, test } from '../helpers';
import { checkScreens, MODES, PHONES, pocket, type Screen } from './helpers';

// The app viewer: the floor's running app, and its desktop view on a phone (#131).

const SCREENS: Screen[] = [
  {
    name: 'app viewer',
    widths: PHONES,
    open: async (page) => {
      const root = await pocket(page, 'kanban');
      await root.getByTitle("Open this floor's running app").click();
      return page.getByRole('dialog');
    },
    tabs: [],
  },
  {
    name: "app viewer, a PR's changes sheet (#203)",
    widths: PHONES,
    open: async (page) => {
      const run = (await pocket(page, 'kanban')).getByTitle(/^Run PR #\d+ beside/).first();
      test.skip(!(await run.count()), 'no open PR on this floor yet');
      await run.click();
      return page.getByRole('dialog');
    },
    tabs: [],
  },
  {
    name: 'app viewer, Desktop on a phone (#131)',
    widths: [360, 390, 430],
    open: async (page) => {
      const root = await pocket(page, 'kanban');
      await root.getByTitle("Open this floor's running app").click();
      const viewer = page.getByRole('dialog');
      await viewer.getByRole('toolbar').getByRole('button', { name: 'Desktop' }).click();
      await expect(viewer.getByText('Turn your phone sideways for the desktop view')).toBeVisible();
      return viewer;
    },
    tabs: [],
  },
];

checkScreens(SCREENS);

// ---------- the preview's desktop view on a phone (#131) ----------
// Desktop on an upright iPhone shows the rotate hint once; turned sideways the viewer goes edge to edge at desktop
// width with a floating ✕ and ⋯ (no office tabs or header), and upright again it's the viewer, in both iOS modes.

for (const mode of MODES) {
  test.describe(`the app viewer turned sideways, ${mode.name}`, () => {
    test.use({ isMobile: true, hasTouch: true, userAgent: mode.userAgent });
    test('Desktop: hint once, edge to edge sideways, the viewer again upright', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewportSize({ width: 390, height: 844 });
      if (mode.standalone) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
      const root = await pocket(page, 'kanban');
      await root.getByTitle("Open this floor's running app").click();
      const viewer = page.getByRole('dialog');
      const pickDesktop = () => viewer.getByRole('toolbar').getByRole('button', { name: 'Desktop' }).click();
      await pickDesktop();
      const hint = viewer.getByText('Turn your phone sideways for the desktop view');
      await expect(hint).toBeVisible();
      await viewer.getByRole('button', { name: 'Got it' }).click();
      await expect(hint).toBeHidden();

      await page.setViewportSize({ width: 844, height: 390 });
      await expect(page.locator('.panel-app-immersive')).toBeVisible();
      const panel = (await page.locator('.panel-app-immersive').boundingBox())!;
      expect([panel.x, panel.y, panel.width, panel.height]).toEqual([0, 0, 844, 390]);
      await expect(viewer.locator('.panel-head')).toBeHidden();
      await expect(page.locator('.pk-tabs')).not.toBeInViewport({ ratio: 0.01 }); // covered: nothing of the office shows
      const frame = (await viewer.locator('.app-frame').boundingBox())!;
      expect(Math.round(frame.width)).toBe(844); // 1280 CSS px scaled to the screen
      expect(await viewer.locator('.app-frame').evaluate((f) => (f as HTMLElement).offsetWidth)).toBe(1280);
      await expect(viewer.getByRole('button', { name: 'Close' }).last()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.panel-app-immersive')).toHaveCount(0);
      await expect(viewer.locator('.panel-head')).toBeVisible();
      await pickDesktop();
      await expect(hint).toBeHidden(); // once
      expect(errors).toEqual([]);
    });

    test('⋯ Full screen goes edge to edge upright, and ‹ Back leaves it', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const root = await pocket(page, 'kanban');
      await root.getByTitle("Open this floor's running app").click();
      const viewer = page.getByRole('dialog');
      await viewer.getByRole('button', { name: 'More for the app' }).click();
      await page.getByRole('menuitem', { name: /Full screen/ }).click();
      await expect(page.locator('.panel-app-immersive')).toBeVisible();
      await page.getByRole('button', { name: 'Leave full screen' }).click();
      await expect(page.locator('.panel-app-immersive')).toHaveCount(0);
      await expect(viewer).toBeVisible();
    });
  });
}

// ---------- the phone's toolbar: one row, Mobile | Desktop in it, the rest in ⋯ (#294) ----------

test('on a phone the toolbar is one row with Start/Stop, Mobile | Desktop and ⋯; at 1280 it is unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const root = await pocket(page, 'kanban');
  await root.getByTitle("Open this floor's running app").click();
  const viewer = page.getByRole('dialog');
  const bar = viewer.getByRole('toolbar', { name: 'App controls' });
  expect((await bar.boundingBox())!.height).toBeLessThan(80); // one row of 44 px buttons
  await expect(bar.getByRole('button', { name: /^(Start|Stop)$/ })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'More for the app' })).toBeVisible();
  const mobile = bar.getByRole('button', { name: 'Mobile' });
  const desktop = bar.getByRole('button', { name: 'Desktop' });
  await mobile.click();
  const stage = viewer.locator('.app-stage');
  await expect(stage).toHaveClass(/app-stage-phone/);
  await desktop.click();
  await expect(stage).not.toHaveClass(/app-stage-phone/);
  await expect(desktop).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('menu')).toHaveCount(0); // no ⋯ on the way
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const chips = await viewer.locator('.channels').evaluate((c) => [...c.querySelectorAll('.channel')].map((x) => x.getBoundingClientRect().width <= c.clientWidth));
  expect(chips.every(Boolean)).toBe(true); // a chip never wider than its row

  // What left the bar is in ⋯.
  await bar.getByRole('button', { name: 'More for the app' }).click();
  for (const item of ['Open in browser', 'Reload', /Full screen/, /Tablet width/, 'Preview stats']) await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1280, height: 800 });
  const width = bar.getByRole('group', { name: 'Viewport width' });
  for (const name of ['Phone', 'Tablet', 'Desktop']) await expect(width.getByRole('button', { name })).toBeVisible();
  await expect(bar.getByRole('button', { name: /Reload/ })).toBeVisible();
  await expect(bar.getByRole('link', { name: /Open in new tab/ })).toBeVisible();
});
