import type { CDPSession, Locator, Page } from '@playwright/test';
import { devices } from '@playwright/test';
import { enterOffice, expect, phoneButton, savedView, test } from './helpers';

// The 3D office on a phone (#83): the bottom half of the screen walks, the top half looks, and a window's buttons
// answer one tap anywhere in their box, under the phone's 115% UI scale (CSS zoom). Drags go in through the DevTools
// protocol, so two fingers can be down at once (Chromium only); the taps also run on WebKit's iPhone 15 when it's
// installed (playwright.config.ts).

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent });
const chromiumOnly = () => test.skip(test.info().project.name === 'iphone', 'fingers through the DevTools protocol');

/** The centre and the four corners, 4px inside the button's rounded shape (no browser counts the cut-off corner). */
const SPOTS = ['centre', 'top left', 'top right', 'bottom left', 'bottom right'] as const;

/** One tap on `target` at SPOTS[i], where a finger would land. */
async function tapAt(page: Page, target: Locator, i: number) {
  const b = (await target.boundingBox())!;
  // the radius on screen: CSS px times the UI scale's zoom, which offsetWidth leaves out
  const radius = await target.evaluate((el: HTMLElement) => parseFloat(getComputedStyle(el).borderTopLeftRadius) * (el.getBoundingClientRect().width / el.offsetWidth));
  const d = Math.min(4 + radius * (1 - Math.SQRT1_2), b.width / 2, b.height / 2);
  const [x, y] = [
    [b.width / 2, b.height / 2],
    [d, d],
    [b.width - d, d],
    [d, b.height - d],
    [b.width - d, b.height - d],
  ][i];
  await page.touchscreen.tap(b.x + x, b.y + y);
}

/** The UI scale the page runs at: a phone's default is 115%, the zoom that used to eat taps. */
const uiScale = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));

type Point = { x: number; y: number };

/** Counts the 3D view's WebGL draw calls, so a test can tell whether it's drawing under a window. */
async function countDraws(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __draws: number };
    w.__draws = 0;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const) {
      const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => void>;
      const real = proto[name];
      proto[name] = function (this: unknown, ...a: unknown[]) {
        w.__draws++;
        return real.apply(this, a);
      };
    }
  });
}

/** The draw calls made over `ms`, after `settle` ms for the frame already under way. */
async function drawsOver(page: Page, ms: number, settle = 500) {
  await page.waitForTimeout(settle);
  const from = await page.evaluate(() => (window as unknown as { __draws: number }).__draws);
  await page.waitForTimeout(ms);
  return (await page.evaluate(() => (window as unknown as { __draws: number }).__draws)) - from;
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
  chromiumOnly();
  const { cdp, from } = await inside(page);
  await drag(cdp, [WALK], () => expect.poll(() => moved(page, from), { message: 'metres walked', timeout: 60_000 }).toBeGreaterThan(0.1));
  expect(await turned(page, from)).toBeLessThan(0.01);
});

test('a drag in the top half turns without walking', async ({ page }) => {
  chromiumOnly();
  const { cdp, from } = await inside(page);
  await drag(cdp, [LOOK], () => expect.poll(() => turned(page, from), { message: 'radians turned', timeout: 60_000 }).toBeGreaterThan(0.1));
  expect(await moved(page, from)).toBeLessThan(0.05);
});

test('one finger in each half walks and turns at once', async ({ page }) => {
  chromiumOnly();
  const { cdp, from } = await inside(page);
  await drag(cdp, [WALK, LOOK], async () => {
    await expect.poll(() => moved(page, from), { message: 'metres walked', timeout: 60_000 }).toBeGreaterThan(0.1);
    await expect.poll(() => turned(page, from), { message: 'radians turned', timeout: 60_000 }).toBeGreaterThan(0.1);
  });
});

// The thumb zones (#123): the stick in the lower-left corner, the look in the lower-right, both at once.
const THUMB_WALK = { from: { x: 90, y: 790 }, to: { x: 90, y: 720 } };
const THUMB_LOOK = { from: { x: 330, y: 560 }, to: { x: 230, y: 560 } };

test('thumbs: the stick in the lower-left and the look in the lower-right work at once', async ({ page }) => {
  chromiumOnly();
  const { cdp, from } = await inside(page);
  await expect(page.getByTestId('stick-ghost')).toBeVisible();
  await drag(cdp, [THUMB_WALK, THUMB_LOOK], async () => {
    await expect(page.getByTestId('stick-ghost')).toBeHidden(); // the stick came up under the thumb
    await expect.poll(() => moved(page, from), { message: 'metres walked', timeout: 60_000 }).toBeGreaterThan(0.1);
    await expect.poll(() => turned(page, from), { message: 'radians turned', timeout: 60_000 }).toBeGreaterThan(0.1);
  });
});

test('thumbs: a tap on the floor above them walks there', async ({ page }) => {
  chromiumOnly();
  const { from } = await inside(page);
  await page.evaluate((yaw) => (window as unknown as { __swarmPlayer: { face: (y: number, p: number) => void } }).__swarmPlayer.face(yaw, -0.6), from.yaw);
  await page.touchscreen.tap(195, 300);
  await expect.poll(() => moved(page, from), { message: 'metres walked', timeout: 60_000 }).toBeGreaterThan(0.5);
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
  chromiumOnly();
  await countDraws(page);
  await inside(page);
  expect(await drawsOver(page, 2000), 'draw calls with no window open').toBeGreaterThan(0);

  // the phone: open, then its ✕
  await phoneButton(page).tap();
  const phone = page.getByRole('dialog', { name: 'Your phone' });
  await expect(phone).toBeVisible();
  expect(await drawsOver(page, 2000), 'draw calls under the phone').toBe(0);
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
    expect(await drawsOver(page, 2000), `draw calls under ${link}`).toBe(0);
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
});

test('windows fit a 390px phone: no sideways scroll, a 44px ✕', async ({ page }) => {
  await inside(page);
  await phoneButton(page).tap();
  await page.getByRole('tab', { name: /Company/ }).tap();
  await page.getByRole('button', { name: '❓ Help' }).tap();
  const panel = page.locator('.panel');
  await expect(panel).toBeVisible();
  // full width, under a band of the dimmed view to tap it closed (48px at the 115% UI scale)
  await expect.poll(async () => JSON.stringify(await panel.boundingBox()), { message: 'the panel, once it has popped in' }).toBe(JSON.stringify({ x: 0, y: 55.1875, width: 390, height: 788.8125 }));
  const x = (await page.locator('.panel-x').boundingBox())!;
  expect(Math.min(x.width, x.height)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});


for (const [i, spot] of SPOTS.entries()) {
  test(`the start screen's buttons answer one tap at the ${spot}`, async ({ page }) => {
    await page.goto('/?pocket=0');
    const enter = page.getByRole('button', { name: 'Enter the office' });
    await expect(enter).toBeEnabled();
    expect(await uiScale(page)).toBe('1.15');
    await tapAt(page, enter, i);
    await expect(enter).toBeHidden();

    await page.goto('/?pocket=0');
    await expect(enter).toBeEnabled();
    await tapAt(page, page.getByRole('button', { name: /Pocket mode, for phones/ }), i);
    await expect(page.locator('.pocket')).toBeVisible();
  });
}

/** Three windows: how to open each, its ✕, and two tabs to tap between (the phone's are its footer). */
const WINDOWS = [
  { name: 'the phone', dialog: 'Your phone', tabs: [/Team/, /Company/], link: null },
  { name: 'help', dialog: 'How the office works', tabs: ['🎮 Controls', '📖 The office'], link: '❓ Help' },
  { name: 'the console', dialog: /Manager's console/, tabs: ['📜 History', /^Time-lapse/], link: '🧑‍💼 Console' },
] as const;

async function open(page: Page, w: (typeof WINDOWS)[number]) {
  await phoneButton(page).tap();
  if (w.link) {
    await page.getByRole('tab', { name: /Company/ }).tap();
    await page.getByRole('button', { name: w.link }).tap();
  }
  const dialog = page.getByRole('dialog', { name: w.dialog });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(300); // the pop-in animation, so the boxes measured are where the finger lands
  return dialog;
}

for (const w of WINDOWS) {
  test(`${w.name}: its ✕ and tabs answer one tap anywhere in their box, and a tap outside closes it`, async ({ page }) => {
    await inside(page);
    expect(await uiScale(page)).toBe('1.15');
    for (const [i, spot] of SPOTS.entries()) {
      const dialog = await open(page, w);
      for (const name of w.tabs) {
        const tab = dialog.getByRole('tab', { name });
        await tab.scrollIntoViewIfNeeded(); // a tab off screen, scrolled to as a swipe would
        await tapAt(page, tab, i);
        await expect(tab, `${String(name)} at the ${spot}`).toHaveAttribute('aria-selected', 'true');
      }
      await tapAt(page, dialog.getByRole('button', { name: 'Close' }), i);
      await expect(dialog, `✕ at the ${spot}`).toBeHidden();
    }
    const dialog = await open(page, w);
    await page.touchscreen.tap(195, 24); // the band of dimmed view above it
    await expect(dialog, 'a tap on the backdrop').toBeHidden();
  });
}


