import type { Page } from '@playwright/test';
import { enterOffice, expect, test } from './helpers';

// The office updating itself never reloads the manager's page (#216): a draft and its file stay put, the new version
// loads on the next tab change with the draft still there, and a message cut off mid-send goes once.

/** A 1x1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const marked = (page: Page) => page.evaluate(() => (window as { marker?: number }).marker === 1);

test('an office update keeps the draft and its file, then loads on the next tab change (#216)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  const box = page.locator('.chat-input textarea');
  await page.locator('.chat-input input[type="file"]:not([capture])').setInputFiles([{ name: 'plan.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(page.locator('.attach-item .small.muted')).toHaveCount(1); // uploaded
  await box.fill('Half a thought about the bakery');
  await page.evaluate(() => ((window as { marker?: number }).marker = 1)); // gone if the page reloads

  await page.request.post('/api/demo/new-commit');
  const pill = page.getByRole('button', { name: 'New version · Update' });
  await expect(pill).toBeVisible();
  await pill.click(); // the draft holds it: it says so and waits
  await expect(page.getByText(/The new version loads once you send or clear your message/)).toBeVisible();
  expect(await marked(page)).toBe(true);
  await expect(box).toHaveValue('Half a thought about the bakery');
  await expect(page.locator('.attach-item')).toHaveCount(1);

  // Another tab: the new version loads there, and the chat's draft and file are back.
  await page.locator('.pk-tabs').getByRole('button', { name: /Company/ }).click();
  await expect(pill).toBeHidden();
  expect(await marked(page)).toBe(false);
  await expect(page.locator('.pk-tab-on', { hasText: 'Company' })).toBeVisible();
  await page.goto('/?pocket=1&tab=chat');
  await expect(box).toHaveValue('Half a thought about the bakery');
  await expect(page.locator('.attach-item')).toHaveCount(1);
});

test('in the 3D office, updates landing never reload the page: the phone stays open and the mouse still looks around (#644)', async ({ page }) => {
  test.setTimeout(90_000);
  await enterOffice(page);
  await page.evaluate(() => ((window as { marker?: number }).marker = 1)); // gone if the page reloads
  await page.request.post('/api/demo/new-commit'); // the live office updates itself on every merge; the demo only when asked
  await expect(page.getByRole('button', { name: 'New version · Update' })).toBeVisible();
  await page.keyboard.press('KeyP');
  const phone = page.locator('.phone-overlay');
  for (let i = 0; i < 4; i++) {
    await expect(phone).toBeVisible();
    await page.request.post('/api/demo/new-commit');
    await page.waitForTimeout(2500);
  }
  await expect(phone).toBeVisible();
  expect(await marked(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(phone).toBeHidden();
  await page.waitForTimeout(500); // a reload would have started by now
  expect(await marked(page)).toBe(true);
  await page.locator('canvas').first().click(); // grabs the mouse for looking around (Player.tsx requestLook)
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.tagName ?? null)).toBe('CANVAS');
  expect(await marked(page)).toBe(true);
});

test('a message cut off mid-send is sent once after the page comes back (#216)', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  // the office takes the message, but the page dies before it hears back
  await page.route('**/api/ceo/message', async (route) => {
    await route.fetch();
    await page.close();
  });
  await page.locator('.chat-input textarea').fill('Ship the bakery once');
  const closed = page.waitForEvent('close');
  await page.locator('.chat-input').getByRole('button', { name: 'Send' }).click().catch(() => undefined); // it may close under the click
  await closed;

  const again = await context.newPage();
  await again.setViewportSize({ width: 390, height: 844 });
  await again.goto('/?pocket=1&tab=chat');
  await expect(again.locator('.bubble-me', { hasText: 'Ship the bakery once' })).toHaveCount(1);
  await again.waitForTimeout(1500); // a resend, had there been one, would have landed
  await expect(again.locator('.bubble-me', { hasText: 'Ship the bakery once' })).toHaveCount(1);
});

test('a message that never left is sent once the page comes back (#216)', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1&tab=chat');
  await page.route('**/api/ceo/message', () => void page.close()); // the page dies before the request goes out
  await page.locator('.chat-input textarea').fill('Ship the cake shop once');
  const closed = page.waitForEvent('close');
  await page.locator('.chat-input').getByRole('button', { name: 'Send' }).click().catch(() => undefined); // it may close under the click
  await closed;

  const again = await context.newPage();
  await again.setViewportSize({ width: 390, height: 844 });
  await again.goto('/?pocket=1&tab=chat');
  await expect(again.locator('.bubble-me', { hasText: 'Ship the cake shop once' })).toHaveCount(1);
  await again.waitForTimeout(1500);
  await expect(again.locator('.bubble-me', { hasText: 'Ship the cake shop once' })).toHaveCount(1);
});
