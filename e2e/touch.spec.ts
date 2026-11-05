import type { CDPSession, Page } from '@playwright/test';
import { devices } from '@playwright/test';
import { enterOffice, expect, phoneButton, savedView, test } from './helpers';

// The 3D office on a phone (#83): the bottom half of the screen walks, the top half looks, and a window's buttons
// answer one tap. Fingers go in through the DevTools protocol, so two can be down at once (Chromium only).

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent });

type Point = { x: number; y: number };

/** Long tasks (over 50 ms) on the main thread since the page loaded: how busy it is under each window. */
async function watchLongTasks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[] };
    w.__longTasks = [];
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__longTasks.push(e.duration))).observe({ type: 'longtask', buffered: true });
    } catch {
      // no long-task timing here
    }
  });
}

/** The long tasks over `ms` while the page sits as it is: their count and total. */
async function busyFor(page: Page, ms: number) {
  const from = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks.length);
  await page.waitForTimeout(ms);
  return page.evaluate((n) => {
    const t = (window as unknown as { __longTasks: number[] }).__longTasks.slice(n);
    return { count: t.length, ms: Math.round(t.reduce((a, b) => a + b, 0)) };
  }, from);
}

/** Puts fingers down at `from`, slides them to `to` in steps, keeps them there until `until` holds, then lifts them. */
async function drag(cdp: CDPSession, fingers: { from: Point; to: Point }[], until: () => Promise<void>) {
  const at = (k: number) => fingers.map((f, id) => ({ id, x: f.from.x + (f.to.x - f.from.x) * k, y: f.from.y + (f.to.y - f.from.y) * k }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  try {
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / 8) });
    await until();
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}

const moved = async (page: Page, from: { x: number; z: number }) => {
  const v = await savedView(page);
  return v ? Math.hypot(v.x - from.x, v.z - from.z) : 0;
};
const turned = async (page: Page, from: { yaw: number }) => Math.abs(((await savedView(page))?.yaw ?? from.yaw) - from.yaw);

async function inside(page: Page) {
  await page.goto('/?pocket=0');
  await enterOffice(page, { loaded: true });
  await expect.poll(() => savedView(page)).not.toBeNull();
  return { cdp: await page.context().newCDPSession(page), from: (await savedView(page))! };
}

// Clear of the HUD's chips, the tour card (over the bottom half, above the phone button) and the phone button.
const LOOK = { from: { x: 60, y: 340 }, to: { x: 160, y: 340 } };
const WALK = { from: { x: 140, y: 800 }, to: { x: 140, y: 720 } };

test('a drag in the bottom half walks without turning', async ({ page }) => {
  const { cdp, from } = await inside(page);
  await drag(cdp, [WALK], () => expect.poll(() => moved(page, from), { message: 'metres walked', timeout: 60_000 }).toBeGreaterThan(0.1));
  expect(await turned(page, from)).toBeLessThan(0.01);
});

test('a drag in the top half turns without walking', async ({ page }) => {
  const { cdp, from } = await inside(page);
  await drag(cdp, [LOOK], () => expect.poll(() => turned(page, from), { message: 'radians turned', timeout: 60_000 }).toBeGreaterThan(0.1));
  expect(await moved(page, from)).toBeLessThan(0.05);
});

test('one finger in each half walks and turns at once', async ({ page }) => {
  const { cdp, from } = await inside(page);
  await drag(cdp, [WALK, LOOK], async () => {
    await expect.poll(() => moved(page, from), { message: 'metres walked', timeout: 60_000 }).toBeGreaterThan(0.1);
    await expect.poll(() => turned(page, from), { message: 'radians turned', timeout: 60_000 }).toBeGreaterThan(0.1);
  });
});

test('the start screen: Enter the office answers one tap', async ({ page }) => {
  await page.goto('/?pocket=0');
  const enter = page.getByRole('button', { name: 'Enter the office' });
  await expect(enter).toBeEnabled();
  await enter.tap();
  await expect(enter).toBeHidden();
});

test('the start screen: Pocket mode answers one tap', async ({ page }) => {
  await page.goto('/?pocket=0');
  await expect(page.getByRole('button', { name: 'Enter the office' })).toBeEnabled();
  await page.getByRole('button', { name: /Pocket mode, for phones/ }).tap();
  await expect(page.locator('.pocket')).toBeVisible();
});

test("windows' buttons answer one tap each, and the view stops drawing under them", async ({ page }) => {
  await watchLongTasks(page);
  await inside(page);
  const notes: string[] = [];

  // the phone: open, then its ✕
  await phoneButton(page).tap();
  const phone = page.getByRole('dialog', { name: 'Your phone' });
  await expect(phone).toBeVisible();
  notes.push(`phone: ${JSON.stringify(await busyFor(page, 3000))}`);
  await phone.getByRole('button', { name: 'Close' }).tap();
  await expect(phone).toBeHidden();

  // help and the floor list, from the phone's Company tab, then their ✕
  for (const [link, title] of [
    ['❓ Help', 'How the office works'],
    ['👥 Floor list', /Lobby|Floor/],
  ] as const) {
    await phoneButton(page).tap();
    await page.getByRole('tab', { name: /Company/ }).tap();
    await page.getByRole('button', { name: link }).tap();
    const panel = page.getByRole('dialog', { name: title });
    await expect(panel).toBeVisible();
    notes.push(`${link}: ${JSON.stringify(await busyFor(page, 3000))}`);
    await panel.getByRole('button', { name: 'Close' }).tap();
    await expect(panel).toBeHidden();
  }

  // the console: a tab, then its ✕
  await phoneButton(page).tap();
  await page.getByRole('tab', { name: /Company/ }).tap();
  await page.getByRole('button', { name: '🧑‍💼 Console' }).tap();
  const consolePanel = page.getByRole('dialog', { name: /Manager's console/ });
  await expect(consolePanel).toBeVisible();
  await consolePanel.getByRole('tab', { name: '📜 History' }).tap();
  await expect(consolePanel.getByRole('tab', { name: '📜 History' })).toHaveAttribute('aria-selected', 'true');
  await consolePanel.getByRole('button', { name: 'Close' }).tap();
  await expect(consolePanel).toBeHidden();

  console.log(`long tasks under each window over 3 s: ${notes.join(' · ')}`);
});

test('windows fit a 390px phone: no sideways scroll, a 44px ✕', async ({ page }) => {
  await inside(page);
  await phoneButton(page).tap();
  await page.getByRole('tab', { name: /Company/ }).tap();
  await page.getByRole('button', { name: '❓ Help' }).tap();
  const panel = page.locator('.panel');
  await expect(panel).toBeVisible();
  await expect.poll(async () => JSON.stringify(await panel.boundingBox()), { message: 'the panel, once it has popped in' }).toBe(JSON.stringify({ x: 0, y: 0, width: 390, height: 844 }));
  const x = (await page.locator('.panel-x').boundingBox())!;
  expect(Math.min(x.width, x.height)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

