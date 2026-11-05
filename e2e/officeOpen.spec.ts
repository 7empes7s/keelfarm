import { devices, test as bare, type Page } from '@playwright/test';
import { expect, test } from './helpers';

// Opening the 3D office from pocket mode on a phone (#79): it opens without a reload, a chunk that won't load or a
// mount error shows a screen with Back to pocket, and a start the browser killed sends the next load to pocket mode.
// Chromium with the iPhone 15's descriptor (the e2e browser is Chromium; WebKit isn't installed here).

const { defaultBrowserType: _browser, ...iphone } = devices['iPhone 15'];
const PHONE = { ...iphone, viewport: { width: 390, height: 844 } };

const openButton = (page: Page) => page.getByRole('button', { name: /Open the 3D office/ }).first();
const failedScreen = (page: Page) => page.getByText("The 3D office couldn't open on this device");

async function openFromPocket(page: Page) {
  await page.goto('/');
  await expect(page.locator('.pocket')).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __sameLoad: boolean }).__sameLoad = true));
  await openButton(page).click();
}

test.describe('the 3D office from pocket mode on a phone', () => {
  test.use(PHONE);

  test('opens without a reload, and the touch controls answer', async ({ page }) => {
    await openFromPocket(page);
    const enter = page.getByRole('button', { name: 'Enter the office' });
    await expect(enter).toBeEnabled();
    await enter.click();
    await expect(page.locator('canvas').first()).toBeVisible();
    // the phone profile: no post-processing on Auto, a lower pixel ratio
    expect(await page.evaluate(() => (window as unknown as { __swarmGfx: { tier: string } }).__swarmGfx.tier)).toBe('low');

    // a finger on the left half walks: the joystick's ring shows under it
    await page.locator('canvas').first().evaluate((el) => {
      const at = (type: string, y: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 90, clientY: y, bubbles: true }));
      at('pointerdown', 640);
      at('pointermove', 600);
      at('pointermove', 560);
    });
    await expect(page.locator('.touch-stick')).toBeVisible();

    expect(await page.evaluate(() => (window as unknown as { __sameLoad?: boolean }).__sameLoad)).toBe(true);
    expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
  });

  test('a start the browser killed sends the next load to pocket mode, saying why', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('cubefarm:mode', 'office');
      localStorage.setItem('cubefarm:office-boot', JSON.stringify({ step: 'entering the office' }));
    });
    // as iOS does after killing the tab: a load without a pagehide having cleared the breadcrumb
    await page.goto('/?tab=company');
    await expect(page.locator('.pocket')).toBeVisible();
    await expect(page.getByText(/The 3D office closed last time: the page reloaded while entering the office/)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('cubefarm:mode'))).toBe('pocket');
  });
});

// These fail on purpose, so the console errors and the failed request they cause are expected: Playwright's own test.
bare.describe('the 3D office failing to open', () => {
  bare.use(PHONE);

  bare('a chunk that will not load shows the error screen, and Back to pocket works', async ({ page }) => {
    await page.route(/\/assets\/Office-[^/]+\.js$/, (route) => route.abort());
    await openFromPocket(page);
    await expect(failedScreen(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.getByRole('button', { name: /Back to pocket/ }).click();
    await expect(openButton(page)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __sameLoad?: boolean }).__sameLoad)).toBe(true);
  });

  bare('a mount error (no WebGL) shows the error screen, and Back to pocket works', async ({ page }) => {
    await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type.startsWith('webgl') ? null : get.call(this, type as '2d', ...(rest as []));
      } as typeof get;
    });
    await openFromPocket(page);
    await expect(failedScreen(page)).toBeVisible();
    await page.getByRole('button', { name: /Back to pocket/ }).click();
    await expect(openButton(page)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('cubefarm:mode'))).toBe('pocket');
  });
});
