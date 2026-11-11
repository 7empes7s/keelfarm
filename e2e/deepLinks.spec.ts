import type { Request } from '@playwright/test';
import { expect, test } from './helpers';

// Deep links (#413): every link the route table offers in this demo office, opened cold in a new page, shows its view
// (<html data-route-ready="1">), never the default page, in pocket mode at a phone's width and in the 3D office.

for (const [mode, width] of [
  ['pocket', 390],
  ['office', 1280],
] as const) {
  test(`every deep link opens its view cold in the ${mode} office`, async ({ page, baseURL }) => {
    test.setTimeout(480_000);
    await page.setViewportSize({ width, height: 800 });
    // A new page load cuts off the last one's requests (a lazy chunk, a panel's fetch): each link's requests to the
    // office finish before the next link loads, so the fixture's failed-request check stays strict. The 3D view loads
    // its chunks once its canvas mounts, after a link's panel may already show; Low graphics never loads the effects'.
    await page.addInitScript(() => localStorage.setItem('cubefarm:graphics', 'low'));
    const pending = new Set<Request>();
    page.on('request', (r) => void (r.url().startsWith(baseURL!) && pending.add(r)));
    const done = (r: Request) => void pending.delete(r);
    page.on('requestfinished', done);
    page.on('requestfailed', done);
    const settled = async (what: string, inside = true) => {
      if (mode === 'office' && inside) await expect(page.locator('canvas').first(), what).toBeAttached();
      await expect.poll(async () => pending.size === 0 && (await page.waitForTimeout(1000), pending.size === 0), { message: `${what}'s requests`, timeout: 30_000 }).toBe(true);
    };
    const q = `?pocket=${mode === 'pocket' ? 1 : 0}`;
    await page.goto(`/${q}`);
    await expect(page.locator('html[data-route-ready="1"]')).toBeAttached();
    await settled('the first load', false); // the 3D office's start screen: no canvas yet
    const links = await page.evaluate(() => (window as unknown as { __swarmRoutes: { links(): string[] } }).__swarmRoutes.links());
    expect(links.length).toBeGreaterThan(15);
    for (const [i, link] of links.entries()) {
      await page.goto(`/${q}&cold=${i}${link}`); // a new query: a full load, not a hash change
      await expect(page.locator('html'), link).toHaveAttribute('data-route-ready', '1', { timeout: 30_000 });
      await settled(link);
    }
  });
}
