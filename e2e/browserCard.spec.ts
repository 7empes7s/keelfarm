import type { Page } from '@playwright/test';
import type { AgentView, WorldSnapshot } from '../shared/types';
import { buttonRowProblems } from './buttonRows';
import { expect, test } from './helpers';
import { dialog, office } from './layout/helpers';

// The agent window in the 3D office (#230): its browser card shows a real address (not about:blank), the whole window
// fits with the CEO's chat open or closed, and a toast never covers a panel's header or tab row.

/** Waits for a demo agent whose browser card has an address: a screenshot that said its page. */
async function agentWithAddress(page: Page): Promise<AgentView> {
  let found: AgentView | undefined;
  await expect
    .poll(
      async () => {
        const state = (await (await page.request.get('/api/state')).json()) as WorldSnapshot;
        found = state.agents.find((a) => a.role !== 'ceo' && a.hasScreenshot && a.browserUrl);
        return !!found;
      },
      { timeout: 90_000, intervals: [2000] },
    )
    .toBe(true);
  return found!;
}

/** Overlaps and clipping inside the agent window, and buttons under 44px or with labels off centre (#170's guard). */
async function windowProblems(page: Page) {
  const win = page.locator('.panel.aw');
  const own = await win.evaluate((el) => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    const panel = el.getBoundingClientRect();
    if (panel.right > vw + 1 || panel.bottom > innerHeight + 1) out.push('the window runs off the screen');
    for (const x of el.querySelectorAll<HTMLElement>('.panel-head, .aw-main, .bc, .bc-bar, .bc-shot, button')) {
      if (!x.checkVisibility()) continue;
      const r = x.getBoundingClientRect();
      if (r.right > panel.right + 1 || r.left < panel.left - 1) out.push(`${x.className || x.tagName} sticks out of the window`);
    }
    return out;
  });
  return [...own, ...(await buttonRowProblems(win))];
}

for (const width of [1280, 1920]) {
  for (const chat of [false, true]) {
    test(`agent window at ${width}px, CEO chat ${chat ? 'open' : 'closed'}: a real address, nothing clipped`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width, height: width > 1600 ? 1080 : 800 });
      const agent = await agentWithAddress(page);
      await office(page);
      if (chat) {
        await page.keyboard.press('p');
        await expect(dialog(page, /Your phone/)).toBeVisible();
      }
      await page.keyboard.press('l');
      await page.getByTitle(`Watch ${agent.name}'s screen`).click();
      const card = page.locator('.panel.aw .bc');
      await expect(card).toBeVisible();
      await expect(card.locator('.bc-url')).not.toHaveText(/about:blank|address unknown/);
      await expect(card.locator('.bc-caption')).toContainText(`@${agent.name}'s browser`);
      expect(await windowProblems(page)).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`agent-window-${width}-${chat ? 'chat' : 'alone'}.png`) });
    });
  }
}

test('a toast never covers the open panel’s header or tab row', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await office(page);
  await page.keyboard.press('e'); // the manager's console (Settings) from the desk
  const settings = dialog(page, /Manager's console/);
  await expect(settings).toBeVisible();
  const toast = page.locator('.toasts .toast').first();
  await expect(toast).toBeVisible({ timeout: 120_000 }); // the demo's agents keep opening and merging PRs
  await page.waitForTimeout(700); // the placement's next tick
  const overlaps = await page.evaluate(() => {
    const t = document.querySelector('.toasts')!.getBoundingClientRect();
    const hit = (b: DOMRect) => b.width && b.height && t.left < b.right && b.left < t.right && t.top < b.bottom && b.top < t.bottom;
    return [...document.querySelectorAll('.panel-head, [role="tablist"]')].filter((n) => hit(n.getBoundingClientRect())).map((n) => n.className || n.getAttribute('role'));
  });
  expect(overlaps).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('toast-over-settings.png') });
});
