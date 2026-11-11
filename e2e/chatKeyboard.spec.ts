import { devices, type Locator, type Page } from '@playwright/test';
import { enterOffice, expect, phoneButton, test } from './helpers';

// The CEO chat on an iPhone (#297), in pocket mode and in the 3D office's phone: with the keyboard up the message box
// sits inside the visible part of the page, above the keyboard; full screen covers exactly that part, the composer at
// its bottom; nothing scrolls sideways.

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent });

const KEYBOARD = 336;

/** The keyboard: the visual viewport loses `px` at the bottom (iOS: the layout viewport keeps its height), scrolled `top` down;
 *  the conversation at its end before, so it should stay there. */
async function keyboard(page: Page, px: number, top = 0) {
  await page.evaluate(() => document.querySelectorAll('.chat-log').forEach((el) => el.scrollTo(0, el.scrollHeight)));
  await frames(page); // its scroll event (a frame later: software WebGL draws slowly) before the keyboard
  await page.evaluate(
    ([px, top]) => {
      Object.defineProperty(visualViewport!, 'height', { configurable: true, get: () => innerHeight - px - top });
      Object.defineProperty(visualViewport!, 'offsetTop', { configurable: true, get: () => top });
      visualViewport!.dispatchEvent(new Event('resize'));
    },
    [px, top],
  );
  await page.waitForTimeout(400); // the viewport's next frame, and the log following it
}

/** Two frames: the scroll events and resize observations due by then have run. */
const frames = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

const visible = (page: Page) => page.evaluate(() => ({ top: visualViewport!.offsetTop, bottom: visualViewport!.offsetTop + visualViewport!.height }));

/** The message box is fully on screen, above the keyboard, the newest message in view, and nothing scrolls sideways. */
async function aboveKeyboard(page: Page, chat: Locator) {
  const box = (await chat.locator('.chat-input textarea').boundingBox())!;
  const v = await visible(page);
  expect(box.y, 'the message box starts on screen').toBeGreaterThanOrEqual(v.top - 0.5);
  expect(box.y + box.height, 'the message box ends above the keyboard').toBeLessThanOrEqual(v.bottom + 0.5);
  // the newest message in view (the demo's CEO may post one meanwhile: the log follows it)
  const below = () => chat.locator('.chat-log').evaluate((log) => log.lastElementChild!.getBoundingClientRect().bottom - log.getBoundingClientRect().bottom);
  await expect.poll(below, { message: 'the newest message in view' }).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll').toBe(true);
}

/** Full screen: `dock` is the visible part of the page (±1px), the composer at its bottom. */
async function fillsScreen(page: Page, dock: Locator) {
  const [d, input] = await Promise.all([dock.boundingBox(), dock.locator('.chat-input').boundingBox()]);
  const v = await visible(page);
  expect(Math.abs(d!.y - v.top), 'the chat starts at the top').toBeLessThanOrEqual(1);
  expect(Math.abs(d!.y + d!.height - v.bottom), 'the chat ends at the bottom').toBeLessThanOrEqual(1);
  expect(Math.abs(d!.width - 390), 'the chat is the screen wide').toBeLessThanOrEqual(1);
  expect(v.bottom - (input!.y + input!.height), 'nothing under the composer').toBeLessThanOrEqual(12); // the phone's 8px edge
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll').toBe(true);
}

test('pocket mode: the message box above the keyboard, full screen filling the screen', async ({ page }) => {
  await page.goto('/?pocket=1&tab=chat');
  const root = page.locator('.pocket');
  await expect(root.locator('.chat-log')).toBeVisible();
  await root.locator('.chat-input textarea').focus();
  await keyboard(page, KEYBOARD);
  await aboveKeyboard(page, root);
  await root.locator('.chat-input textarea').blur();
  await keyboard(page, 0);

  await root.getByRole('button', { name: 'Full screen chat', exact: true }).click();
  await expect(root).toHaveClass(/pk-chat-full/);
  await fillsScreen(page, root);
  await root.locator('.chat-input textarea').focus();
  await keyboard(page, KEYBOARD);
  await aboveKeyboard(page, root);
});

test("the 3D office's phone: the message box above the keyboard, full screen filling the screen", async ({ page }) => {
  await page.goto('/?pocket=0');
  await enterOffice(page, { loaded: true });
  const skipTour = page.getByRole('button', { name: 'Skip tour' });
  if (await skipTour.isVisible()) await skipTour.dispatchEvent('click');
  await page.addStyleTag({ content: '.toasts { display: none !important; }' }); // the demo's toasts come and go over anything
  await phoneButton(page).tap();
  const phone = page.getByRole('dialog', { name: 'Your phone' });
  await expect(phone.locator('.chat-log')).toBeVisible();
  const overlay = page.locator('.phone-overlay');

  await phone.locator('.chat-input textarea').focus();
  for (const top of [0, 40]) {
    await keyboard(page, KEYBOARD, top); // 40: iOS scrolled the visual viewport down to the field
    await aboveKeyboard(page, phone);
    const [o, v] = await Promise.all([overlay.boundingBox(), visible(page)]);
    expect(Math.abs(o!.y + o!.height - v.bottom), 'the phone ends on the keyboard').toBeLessThanOrEqual(1);
  }
  await phone.locator('.chat-input textarea').blur();
  await keyboard(page, 0);
  await expect(phone.getByRole('tab', { name: 'Team' })).toBeVisible(); // the phone's tabs are back

  await phone.getByRole('button', { name: 'Full screen chat', exact: true }).tap();
  await expect(phone).toHaveClass(/phone-full/);
  await fillsScreen(page, phone);
  await phone.locator('.chat-input textarea').focus();
  await keyboard(page, KEYBOARD);
  await aboveKeyboard(page, phone);
  await fillsScreen(page, phone);

  // Leaving full screen puts the docked phone back, under its band of the office.
  await phone.locator('.chat-input textarea').blur();
  await keyboard(page, 0);
  await page.keyboard.press('Escape'); // leaves full screen first
  await expect(phone).not.toHaveClass(/phone-full/);
  expect((await phone.boundingBox())!.y).toBeGreaterThan(40);
});

// iPhone Chrome (#507): its toolbars and the keyboard's autofill bar leave about 370px, and the keyboard settles 300ms
// after its first, mid-slide resize without telling the page. The message box still ends right on the keyboard, the
// newest message above it; once it closes the band of the office is back.
test("the 3D office's phone: the message box on a late, tall keyboard", async ({ page }) => {
  await page.goto('/?pocket=0');
  await enterOffice(page, { loaded: true });
  const skipTour = page.getByRole('button', { name: 'Skip tour' });
  if (await skipTour.isVisible()) await skipTour.dispatchEvent('click');
  await page.addStyleTag({ content: '.toasts { display: none !important; }' });
  await phoneButton(page).tap();
  const phone = page.getByRole('dialog', { name: 'Your phone' });
  await expect(phone.locator('.chat-log')).toBeVisible();
  const field = phone.locator('.chat-input textarea');

  await page.evaluate(() => {
    const w = window as { kb?: number };
    Object.defineProperty(visualViewport!, 'height', { configurable: true, get: () => innerHeight - (w.kb ?? 0) });
  });
  const kb = (px: number, resize: boolean) =>
    page.evaluate(
      ([px, resize]) => {
        (window as { kb?: number }).kb = px as number;
        if (resize) visualViewport!.dispatchEvent(new Event('resize'));
      },
      [px, resize] as const,
    );
  await field.focus();
  await kb(200, true); // mid-slide
  await page.waitForTimeout(300);
  await kb(474, false); // where it settles, never reported
  // a frame measuring the settled size before the next check (it must still tell the phone)
  await page.evaluate(() => document.dispatchEvent(new FocusEvent('focusin')));
  await page.waitForTimeout(1500);

  const [input, v] = await Promise.all([phone.locator('.chat-input').boundingBox(), visible(page)]);
  expect(input!.y + input!.height, 'the composer ends above the keyboard').toBeLessThanOrEqual(v.bottom + 0.5);
  expect(input!.y + input!.height, 'no gap under the composer').toBeGreaterThanOrEqual(v.bottom - 8);
  const latest = await phone.locator('.chat-log').evaluate((log) => {
    const l = log.getBoundingClientRect();
    const m = log.lastElementChild!.getBoundingClientRect();
    return { shows: m.bottom > l.top + 1 && m.bottom <= l.bottom + 1, logHeight: l.height };
  });
  expect(latest.logHeight, 'the thread has room above the composer').toBeGreaterThan(40);
  expect(latest.shows, 'the newest message ends in view').toBe(true);

  await field.blur();
  await kb(0, true);
  await page.waitForTimeout(600);
  await expect(phone.getByRole('tab', { name: 'Team' })).toBeVisible();
  expect((await phone.boundingBox())!.y, 'the band of the office is back').toBeGreaterThan(40);
});
