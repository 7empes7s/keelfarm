import { devices, type Locator, type Page } from '@playwright/test';
import { enterOffice, expect, phoneButton, test } from './helpers';

// The CEO's live step log on a phone (#526): opened while a long job streams its steps, with the keyboard up, it
// scrolls inside itself; the message box and what's typed stay above the keyboard and the conversation stays reachable.

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent });

/** The keyboard (as chatKeyboard.spec.ts): the visual viewport loses `px` at the bottom, the layout viewport keeps its height. */
async function keyboard(page: Page, px: number) {
  await page.evaluate((px) => {
    Object.defineProperty(visualViewport!, 'height', { configurable: true, get: () => innerHeight - px });
    visualViewport!.dispatchEvent(new Event('resize'));
  }, px);
  await page.waitForTimeout(400);
}

/** A long job running (its 17th step takes a minute), its log open, the keyboard up, a message typed: everything still fits. */
async function check(page: Page, chat: Locator) {
  await expect(chat.locator('.working-meta', { hasText: /step (1[7-9]|[2-9]\d)/ })).toBeVisible({ timeout: 90_000 });
  await chat.locator('.working-main').tap();
  await expect(chat.locator('.working-strip .step-log')).toBeVisible();
  const field = chat.locator('.chat-input textarea');
  await field.focus();
  await keyboard(page, 336);
  await field.pressSequentially('Keep going');
  await expect(field).toHaveValue('Keep going');
  const bottom = await page.evaluate(() => visualViewport!.height);
  const box = () => field.boundingBox().then((b) => b!);
  await expect.poll(() => box().then((b) => b.y + b.height), { message: 'the message box ends above the keyboard' }).toBeLessThanOrEqual(bottom + 0.5);
  await expect.poll(() => box().then((b) => b.y), { message: 'the message box starts on screen' }).toBeGreaterThanOrEqual(0);
  const log = chat.locator('.working-strip .step-log');
  expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight + 1), 'the steps scroll inside their panel').toBe(true);
  const thread = chat.locator('.chat-log');
  expect((await thread.boundingBox())!.height, 'the conversation keeps room above the steps').toBeGreaterThan(40);
  await thread.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const below = () => thread.evaluate((el) => el.lastElementChild!.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom);
  await expect.poll(below, { message: 'the newest message reachable' }).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll').toBe(true);
  await page.request.post('/api/ceo/stop'); // its minute-long step would hold up the next test's job
}

test('pocket mode: the open step log leaves the message box above the keyboard', async ({ page }) => {
  await page.request.post('/api/ceo/message', { data: { text: 'Look into the joystick on phones thoroughly' } });
  await page.goto('/?pocket=1&tab=chat');
  await check(page, page.locator('.pocket'));
});

test("the 3D office's phone: the open step log leaves the message box above the keyboard", async ({ page }) => {
  await page.goto('/?pocket=0');
  await enterOffice(page, { loaded: true });
  const skipTour = page.getByRole('button', { name: 'Skip tour' });
  if (await skipTour.isVisible()) await skipTour.dispatchEvent('click');
  await page.addStyleTag({ content: '.toasts { display: none !important; }' }); // the demo's toasts come and go over anything
  await page.request.post('/api/ceo/message', { data: { text: 'Look into the joystick on phones thoroughly' } });
  await phoneButton(page).tap();
  await check(page, page.getByRole('dialog', { name: 'Your phone' }));
});
