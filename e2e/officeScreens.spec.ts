import { devices, type Locator, type Page } from '@playwright/test';
import { expect, TOUR_SEEN_KEY, test } from './helpers';
import { dialog, office } from './layout/helpers';

// The 3D office's screen audit (#516): every overlay opens on a phone and closes again by its ✕ (the fixture fails on
// console errors), and the HUD's floating pieces (toasts, the What's new card, the keys line) stay on screen and off
// each other.

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent };

/** This device has seen no tour step, so What's new shows (once: the page may save more as the test goes). */
const nothingSeen = (page: Page) =>
  page.addInitScript((key) => {
    if (sessionStorage.getItem('seen-reset')) return;
    sessionStorage.setItem('seen-reset', '1');
    localStorage.setItem(key, '[]');
  }, TOUR_SEEN_KEY);

const rect = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Closes `root` by its visible ✕ and checks it went. */
async function closeBy(root: Locator) {
  const x = root.getByRole('button', { name: /^(Close|Back)/ }).first();
  await expect(x).toBeVisible();
  await x.tap();
  await expect(root).toBeHidden();
}

test.describe('on a phone', () => {
  test.use(PHONE);

  test('every 3D overlay opens and closes by its ✕ at 390px (#516)', async ({ page }) => {
    await office(page);
    const phone = dialog(page, /Your phone/);
    const openPhone = async () => {
      await page.getByTitle(/^Your phone/).tap();
      await expect(phone).toBeVisible();
    };
    // the phone, tab by tab
    await openPhone();
    for (const tab of ['Team', 'Company', 'Games']) {
      await phone.getByRole('tab', { name: tab }).tap();
      await expect(phone.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    }
    await closeBy(phone);
    // the panels on its Company tab
    for (const [button, name] of [
      [/Console/, /Manager's console/],
      [/Floor list/, /Floor|Lobby/],
      [/Map room/, /Map room/],
      [/Help/, /How the office works/],
    ] as const) {
      await openPhone();
      await phone.getByRole('tab', { name: 'Company' }).tap();
      await phone.getByRole('button', { name: button }).tap();
      await closeBy(dialog(page, name));
    }
    // the top bar: the floor card, the bell and Options
    await page.locator('.hud-floor-chip').tap();
    await closeBy(dialog(page, /Lobby/));
    await page.locator('.hud .notice-bell').tap();
    await closeBy(dialog(page, /Notifications/));
    await page.getByRole('button', { name: 'Options' }).tap();
    await closeBy(dialog(page, /^Options/));
  });

  test("the phone's ✕ stands out on its dark frame (#516)", async ({ page }) => {
    await office(page);
    await page.getByTitle(/^Your phone/).tap();
    const x = dialog(page, /Your phone/).locator('.phone-x');
    await expect(x).toBeVisible();
    // the x's colour against its fill laid over the frame: WCAG's 3:1 for an icon
    const contrast = await x.evaluate((el) => {
      const rgba = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
      const [fr, fg, fb] = rgba(getComputedStyle(el.closest('.phone')!).backgroundColor);
      const [br, bg, bb, ba = 1] = rgba(getComputedStyle(el).backgroundColor);
      const fill = [br * ba + fr * (1 - ba), bg * ba + fg * (1 - ba), bb * ba + fb * (1 - ba)];
      const lum = (c: number[]) => c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const [a, b] = [lum(rgba(getComputedStyle(el).color)), lum(fill)];
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(3);
  });

  test("the phone's chat shows its thread, nothing hanging under its screen to scroll it away (#516)", async ({ page }) => {
    await office(page);
    await page.getByTitle(/^Your phone/).tap();
    const phone = dialog(page, /Your phone/);
    if (!(await phone.locator('.chat-input').isVisible())) await phone.locator('.phone-tab').first().tap(); // it opens on Team when a team change waits there
    await expect(phone.locator('.chat-log .bubble').first()).toBeVisible();
    await expect(phone.locator('.chat-input textarea'), 'the keyboard waits for a tap').not.toBeFocused();
    await expect(phone.getByRole('tab', { name: 'Team' }), "the phone's tabs show").toBeVisible();
    await page.waitForTimeout(1000); // the log settles at its end
    const screen = await phone.locator('.phone-screen').evaluate((el) => ({ top: el.scrollTop, over: el.scrollHeight - el.clientHeight }));
    expect(screen.over, 'nothing overflows the screen').toBeLessThanOrEqual(1);
    expect(screen.top, 'the screen is not scrolled').toBe(0);
    const [s, head] = await Promise.all([rect(phone.locator('.phone-screen')), rect(phone.locator('.chat-head'))]);
    expect(head.top, "the chat's header is on the screen").toBeGreaterThanOrEqual(s.top);
  });

  test("toasts stay on screen under the phone's UI scale and off the What's new card (#516)", async ({ page }) => {
    await nothingSeen(page);
    await office(page);
    const card = page.locator('.tour-invite-float');
    await expect(card).toBeVisible();
    await expect(page.locator('.notice-toast').first()).toBeVisible(); // the demo's notices come in as you arrive
    await page.waitForTimeout(800); // useToastSpot's next tick
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    const c = await rect(card);
    const toasts = await Promise.all((await page.locator('.toasts > *').all()).map(rect));
    for (const r of toasts) expect([r.left >= 0, r.right <= vw], 'a toast on screen, start and end').toEqual([true, true]);
    for (const r of toasts) expect(overlap(r, c), "a toast is over the What's new card").toBe(false);
  });
});

test("on a computer the What's new card leaves the keys line readable (#516)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await nothingSeen(page);
  await office(page);
  const [card, keys] = [page.locator('.tour-invite-float'), page.locator('.hud-help')];
  await expect(card).toBeVisible();
  await expect(keys).toBeVisible();
  expect(overlap(await rect(card), await rect(keys))).toBe(false);
});
