import type { Request } from '@playwright/test';
import { expect, test } from './helpers';

// Deep links (#413): every link the route table offers in this demo office, opened cold in a new page, shows its view
// (<html data-route-ready="1">), never the default page, in pocket mode at a phone's width and in the 3D office.

for (const [mode, width] of [
  ['pocket', 390],
  ['office', 1280],
] as const) {
  test(`every deep link opens its view cold in the ${mode} office`, async ({ page }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width, height: 800 });
    // A new page load cuts off the last one's requests (the app viewer's previews watch, a lazy chunk): each link's
    // requests finish before the next link loads, so the fixture's failed-request check stays strict.
    const pending = new Set<Request>();
    page.on('request', (r) => void pending.add(r));
    const settle = (r: Request) => void pending.delete(r);
    page.on('requestfinished', settle);
    page.on('requestfailed', settle);
    const q = `?pocket=${mode === 'pocket' ? 1 : 0}`;
    await page.goto(`/${q}`);
    await expect(page.locator('html[data-route-ready="1"]')).toBeAttached();
    await expect.poll(() => pending.size).toBe(0);
    const links = await page.evaluate(() => (window as unknown as { __swarmRoutes: { links(): string[] } }).__swarmRoutes.links());
    expect(links.length).toBeGreaterThan(15);
    for (const [i, link] of links.entries()) {
      await page.goto(`/${q}&cold=${i}${link}`); // a new query: a full load, not a hash change
      await expect(page.locator('html'), link).toHaveAttribute('data-route-ready', '1', { timeout: 30_000 });
      await expect.poll(() => pending.size, `${link}'s requests`).toBe(0);
    }
  });
}
