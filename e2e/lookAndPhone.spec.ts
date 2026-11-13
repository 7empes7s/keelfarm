import type { Page } from '@playwright/test';
import { enterOffice, expect, phoneButton, savedView, test } from './helpers';

// The 3D office once the tour is over (#651): a click grabs the mouse and keeps it (a tutorial's "give the mouse back"
// listener had freed every grab two milliseconds later), the phone opens on screen (the chat's wide rows had widened
// its overlay's grid and put it off to the right), and an old tab asking for a bundle that's gone gets a 404.

const locked = (page: Page) => page.evaluate(() => document.pointerLockElement?.tagName ?? null);

/** The phone's box inside the window, or what's wrong with it. */
const phoneOnScreen = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector('.phone')?.getBoundingClientRect();
    if (!r) return 'no phone';
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight ? 'on screen' : `at x ${Math.round(r.left)}–${Math.round(r.right)} of ${innerWidth}`;
  });

test.beforeEach(async ({ page }) => {
  await page.request.patch('/api/settings', { data: { tutorialStep: -1 } }); // the first-run tour is over, as on the live office
});

test('a click on the 3D view keeps the mouse grabbed and turns the camera; Esc frees it (#651)', async ({ page }) => {
  await enterOffice(page);
  await page.keyboard.press('Escape'); // free whatever the Enter click grabbed
  await expect.poll(() => locked(page)).toBeNull();
  await page.waitForTimeout(1200); // the browser refuses a new grab just after Esc
  await page.locator('canvas').first().click();
  await expect.poll(() => locked(page)).toBe('CANVAS');
  await page.waitForTimeout(1000);
  expect(await locked(page), 'still grabbed a second later').toBe('CANVAS');
  await expect.poll(() => savedView(page)).not.toBeNull();
  const before = (await savedView(page))!.yaw;
  for (let i = 1; i <= 40; i++) await page.mouse.move(400 + i * 4, 225); // small steps: the look filter drops spikes
  await expect.poll(async () => Math.abs((await savedView(page))!.yaw - before), { timeout: 30_000 }).toBeGreaterThan(0.05);
  await page.keyboard.press('Escape');
  await expect.poll(() => locked(page)).toBeNull();
});

for (const width of [1280, 390]) {
  test(`P and the phone button open the phone on screen at ${width}px, and it stays open (#651)`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/?pocket=0'); // the 3D office at 390px too, as a phone can ask for it
    await enterOffice(page, { loaded: true });
    await page.keyboard.press('KeyP');
    await expect.poll(() => phoneOnScreen(page)).toBe('on screen');
    await expect(page.locator('.phone .phone-tabs')).toBeVisible(); // its content, not just the dimmed office
    await page.keyboard.press('Escape');
    await expect(page.locator('.phone')).toBeHidden();
    await expect.poll(() => locked(page)).toBe('CANVAS'); // closing it grabs the mouse again, and the grab holds
    await page.keyboard.press('Escape'); // free it to reach the button
    await expect.poll(() => locked(page)).toBeNull();
    await phoneButton(page).click();
    await expect.poll(() => phoneOnScreen(page)).toBe('on screen');
    await page.waitForTimeout(20_000);
    expect(await phoneOnScreen(page), 'still open 20 s later').toBe('on screen');
    await page.keyboard.press('Escape');
    await expect(page.locator('.phone')).toBeHidden();
  });
}

test('pocket mode at 390px: the chat fits the screen (#651)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  await expect(page.locator('.chat-input textarea')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('a bundle that is gone after an update is a 404, never the page (#651)', async ({ page }) => {
  const res = await page.request.get('/assets/Office-gone0000.js');
  expect(res.status()).toBe(404);
  expect(res.headers()['content-type'] ?? '').not.toMatch(/javascript/);
  expect((await page.request.get('/floor/1')).status()).toBe(200); // deep links still get the page
});
