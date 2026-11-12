import { devices, type Page } from '@playwright/test';
import { MANAGER_DESK } from '../client/src/world/layout';
import { enterOffice, expect, startAt, test, type SavedView } from './helpers';

// The prompt card for what you aim at (#507): its key chip, its words and (on a touch screen) its ⋯ sit on one line,
// centred on each other, and the card fits the screen.

const AT_CONSOLE: SavedView = { floor: 0, x: MANAGER_DESK.x, z: MANAGER_DESK.z + MANAGER_DESK.d / 2 + 0.8, yaw: 0, pitch: -0.6 };

/** The vertical centres of the card's chip, its words (the text outside the chip and the ⋯) and its ⋯. */
async function centres(page: Page) {
  const skipTour = page.getByRole('button', { name: 'Skip tour' });
  if (await skipTour.isVisible()) await skipTour.dispatchEvent('click');
  const hint = page.locator('.hud-hint');
  await expect(hint).toContainText("Open the manager's console");
  return hint.evaluate((el) => {
    const mid = (r: DOMRect) => r.top + r.height / 2;
    const words = [...el.querySelectorAll('*'), el].flatMap((n) => [...n.childNodes]).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.includes("Open the manager's console"))!;
    const range = document.createRange();
    range.selectNodeContents(words);
    const more = el.querySelector('.hint-more');
    const box = el.getBoundingClientRect();
    return { chip: mid(el.querySelector('kbd')!.getBoundingClientRect()), words: mid(range.getBoundingClientRect()), more: more && mid(more.getBoundingClientRect()), left: box.left, right: box.right };
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent });
  test('Tap, the words and ⋯ share one centre line', async ({ page }) => {
    await startAt(page, AT_CONSOLE);
    await page.goto('/?pocket=0');
    await enterOffice(page, { loaded: true });
    const c = await centres(page);
    expect(Math.abs(c.chip - c.words), 'the chip and the words').toBeLessThanOrEqual(1);
    expect(Math.abs(c.more! - c.words), '⋯ and the words').toBeLessThanOrEqual(1);
    expect(c.left, 'the card starts on screen').toBeGreaterThanOrEqual(0);
    expect(c.right, 'the card ends on screen').toBeLessThanOrEqual(390);
  });
});

test('on a computer the key and the words share one centre line', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startAt(page, AT_CONSOLE);
  await enterOffice(page);
  const c = await centres(page);
  expect(Math.abs(c.chip - c.words)).toBeLessThanOrEqual(1);
});
