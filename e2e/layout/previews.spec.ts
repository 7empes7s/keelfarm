import { expect, test } from '../helpers';
import type { Page } from '@playwright/test';
import { checkScreens, pocket, type Screen } from './helpers';

// The Previews page (#226): from the rail (a desktop) or ⚙️ (a phone), filling everything beside the CEO chat, its
// grouped list with titles never clipped mid-word, and the #previews/<floor>/<main|pr-N> deep link.

/** The page from the menu: the rail's Previews when wide, the top row of ⚙️ on a phone. */
async function openPreviews(page: Page) {
  const root = await pocket(page, 'company');
  const rail = root.locator('.pk-tabs').getByRole('button', { name: /Previews/ });
  if (await rail.isVisible()) await rail.click();
  else {
    await root.getByRole('button', { name: 'Settings and notifications' }).click();
    await page.getByRole('button', { name: /^Previews/ }).click();
  }
  const dialog = page.getByRole('dialog', { name: /Previews/ });
  await expect(dialog.locator('.pv')).toBeVisible();
  return dialog;
}

const SCREENS: Screen[] = [{ name: 'the Previews page (#226)', widths: [390, 1280, 1920], open: openPreviews, tabs: [] }];

checkScreens(SCREENS);

/** Sets the docked chat open or closed for the next load (Pocket.tsx DOCK_KEY). */
const chatDocked = (page: Page, open: boolean) => page.addInitScript((v) => localStorage.setItem('cubefarm:pocket-chat', v), open ? '1' : '0');

for (const width of [390, 1280, 1920]) {
  for (const chat of width < 1024 ? [false] : [true, false]) {
    test(`at ${width}px, chat ${chat ? 'open' : 'closed'}: the page fills the content area and the list shows its groups`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      await chatDocked(page, chat);
      const dialog = await openPreviews(page);
      const panel = (await dialog.boundingBox())!;
      if (width < 1024) {
        expect([Math.round(panel.x), Math.round(panel.width)]).toEqual([0, width]);
        await dialog.getByRole('button', { name: /All previews/ }).click();
      } else {
        const work = (await page.locator('.pk-work').boundingBox())!;
        expect(Math.abs(panel.x - work.x)).toBeLessThan(2);
        expect(Math.abs(panel.width - work.width)).toBeLessThan(2);
        expect(Math.abs(panel.height - work.height)).toBeLessThan(2);
        const dock = page.locator('.pk-dock');
        await expect(dock).toHaveCount(chat ? 1 : 0);
        if (chat) expect(panel.x + panel.width).toBeLessThanOrEqual((await dock.boundingBox())!.x + 1);
      }
      const list = page.locator('.pv-list').last();
      for (const g of ['Running now', 'By project', 'By agent', 'By PR']) await expect(list.locator('.pv-group-head', { hasText: new RegExp(`^${g} \\(`) })).toBeVisible();
      // open every group: each title is at most two lines, and no word is broken across them
      for (const d of await list.locator('details.pv-group:not([open]) > summary').all()) await d.click();
      const titles = await list.locator('.pv-row-title').evaluateAll((els) =>
        els.map((el) => ({ text: el.textContent, lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)), sideways: el.scrollWidth > el.clientWidth + 1 })),
      );
      expect(titles.length).toBeGreaterThan(0);
      for (const t of titles) {
        expect(t.lines, t.text ?? '').toBeLessThanOrEqual(2);
        expect(t.sideways, t.text ?? '').toBe(false);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

test('the deep link opens the right preview, and picking one updates the address', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?pocket=1&tab=company#previews/1/main');
  const dialog = page.getByRole('dialog', { name: /Previews/ });
  await expect(dialog.locator('.app-bare-head')).toBeVisible();
  await expect(dialog.locator('.pv-row-on').first()).toContainText('Live app');
  // a PR whose preview is up: picking one that isn't starts it, which the demo refuses once its PR slots are full
  const pr = dialog.locator('.pv-project .pv-row', { hasText: /PR #\d+/, has: page.locator('.led-live, .led-busy') }).first();
  test.skip(!(await pr.count()), 'no PR preview running in the demo yet');
  const n = (await pr.locator('.pv-row-meta').innerText()).match(/PR #(\d+)/)![1];
  const floor = await pr.evaluate((el) => el.closest('.pv-project')?.querySelector('.floor-badge')?.textContent);
  await pr.click();
  await expect(page).toHaveURL(new RegExp(`#previews/${floor}/pr-${n}$`));
  await expect(dialog.locator('.pv-row-on').first()).toContainText(`PR #${n}`);
  // Esc goes back to where you were, the address too
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe('');
});
