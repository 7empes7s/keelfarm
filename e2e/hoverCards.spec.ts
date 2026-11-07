import type { Page } from '@playwright/test';
import { expect, test } from './helpers';

// Hover cards (#213): a chat ref's peek on hover shows its status and stays on screen, never over the message box;
// on a phone a long press opens it as a sheet and a tap still opens the card.

let n = 0; // the issue the chip names

/** A message naming an open issue of floor 1, and its chip. */
async function issueChip(page: Page) {
  const state = await (await page.request.get('/api/state')).json();
  const repo = (state.repos as { floor: number; issues: { number: number }[] }[]).find((r) => r.floor === 1)!;
  n = repo.issues[0].number;
  await page.request.post('/api/ceo/message', { data: { text: `Where does #${n} on floor 1 stand? (peek)` } });
  await page.goto('/?pocket=1&tab=chat');
  const chip = page.locator('.bubble-text', { hasText: '(peek)' }).last().locator('.ref-chip', { hasText: `#${n}` });
  await expect(chip).toBeVisible();
  return chip;
}

const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('a chat ref peeks on hover at 1280px, on screen and clear of the message box', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const chip = await issueChip(page);
  await expect(page.locator('.pk-dock')).toBeVisible(); // the CEO chat open beside the pages
  await chip.hover();
  const peek = page.getByRole('tooltip');
  await expect(peek).toBeVisible();
  await expect(peek).toContainText(`Issue #${n}`);
  await expect(peek).toContainText(/open/);
  await expect(chip).toHaveAttribute('aria-describedby', (await peek.getAttribute('id'))!);
  const box = (await peek.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  expect(box.y + box.height).toBeLessThanOrEqual(800);
  expect(overlap(box, (await page.locator('.chat-input').boundingBox())!)).toBe(false);
  // Esc dismisses it without closing anything under it
  await page.keyboard.press('Escape');
  await expect(peek).toBeHidden();
  await expect(page.locator('.pk-dock')).toBeVisible();
});

test('keyboard focus opens a peek too', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const chip = await issueChip(page);
  await chip.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab'); // focus from the keyboard: :focus-visible
  await expect(page.getByRole('tooltip')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('a long press shows the sheet, a tap still opens the card at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const chip = await issueChip(page);
    const touch = { pointerType: 'touch', isPrimary: true, bubbles: true };
    await chip.dispatchEvent('pointerdown', touch);
    await page.waitForTimeout(700);
    await chip.dispatchEvent('pointerup', touch);
    await chip.dispatchEvent('click');
    const sheet = page.getByRole('dialog', { name: `#${n}` });
    await expect(sheet).toBeVisible();
    await expect(page.locator('.cardview')).toHaveCount(0); // the hold wasn't a tap
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    await chip.tap();
    await expect(page.locator('.cardview').first()).toBeVisible();
  });
});
